"""Reading the game's binary LSF resources (LSOF, versions 5 to 7), into the same node shape as lsx.py."""
# Ported from LSLib (https://github.com/Norbyte/lslib, MIT, tag v1.20.4): LSLib/LS/Resources/LSF/LSFReader.cs, LSFCommon.cs, LSLib/LS/NodeAttribute.cs, LSLib/LS/Compression.cs, LSLib/LS/Enums/LSFVersion.cs, LSLib/LS/BinUtils.cs
import struct
import uuid

from scripts.data.pak import decompress

Node = dict  # {"id": str, "attributes": dict[str, str], "children": list[Node]}

MAGIC = b"LSOF"
VERSIONS = (5, 6, 7)  # LSFVersion: VerBG3ExtendedHeader (5), VerBG3NodeKeys (6), VerBG3Patch3 (7)
_KEYS_AND_ADJACENCY = 1  # LSFMetadataFormat; 0 and 2 both mean the short (V2) tables
_LZ4 = 2  # CompressionMethod, low four bits of the compression flags
_LZ4_FRAME_MAGIC = 0x184D2204


def _lz4_into(src: bytes, out: bytearray) -> None:
    """Decode one whole LZ4 block, appending to `out`; matches may reach into what `out` already holds."""
    i = 0
    n = len(src)
    while i < n:
        token = src[i]
        i += 1
        lit = token >> 4
        if lit == 15:
            while True:
                b = src[i]
                i += 1
                lit += b
                if b != 255:
                    break
        if i + lit > n:
            raise IndexError("LZ4 literals past the end of the block")
        out += src[i : i + lit]
        i += lit
        if i >= n:  # the last sequence has literals only
            break
        off = src[i] | (src[i + 1] << 8)
        i += 2
        if off == 0 or off > len(out):
            raise ValueError(f"malformed LZ4 block: match offset {off} outside the {len(out)} bytes decoded")
        ml = token & 15
        if ml == 15:
            while True:
                b = src[i]
                i += 1
                ml += b
                if b != 255:
                    break
        ml += 4
        start = len(out) - off
        if ml <= off:
            out += out[start : start + ml]
        else:
            for k in range(ml):
                out.append(out[start + k])


def lz4_frame(data: bytes) -> bytes:
    """Content of an LZ4 frame (what LSLib's chunked LZ4 sections are); blocks may be linked. Header, block and
    content checksums are skipped, not verified (xxHash is not in the standard library)."""
    magic, flg, _bd = struct.unpack_from("<IBB", data, 0)
    if magic != _LZ4_FRAME_MAGIC:
        raise ValueError(f"not an LZ4 frame: magic {magic:#x}")
    if flg >> 6 != 1:
        raise ValueError(f"unsupported LZ4 frame version {flg >> 6}")
    if flg & 0x01:
        raise ValueError("LZ4 frame with a dictionary id is not supported")
    block_checksum = bool(flg & 0x10)
    i = 6 + (8 if flg & 0x08 else 0) + 1  # descriptor, optional content size, header checksum
    out = bytearray()
    while True:
        (size,) = struct.unpack_from("<I", data, i)
        i += 4
        if size == 0:
            break
        stored = bool(size & 0x80000000)
        size &= 0x7FFFFFFF
        if i + size > len(data):
            raise IndexError("LZ4 frame block past the end of the data")
        block = data[i : i + size]
        i += size
        if stored:
            out += block
        else:
            _lz4_into(block, out)
        if block_checksum:
            i += 4
    return bytes(out)


def guid(raw: bytes) -> str:
    """Text of a 16-byte LSF guid: .NET `new Guid(bytes)` then LSLib's ByteSwapGuid (pairs 8..15 swapped)."""
    b = bytearray(raw)
    for i in range(8, 16, 2):
        b[i], b[i + 1] = b[i + 1], b[i]
    return str(uuid.UUID(bytes_le=bytes(b)))


def _plain(x: float) -> str:
    """Python's shortest repr without a trailing ".0" (20.0 -> "20", 1e-05 stays "1e-05")."""
    s = repr(x)
    return s[:-2] if s.endswith(".0") else s


def float32_text(x: float) -> str:
    """Shortest decimal text that reads back as the same single-precision float."""
    packed = struct.pack("<f", x)
    for p in range(1, 10):
        candidate = float("%.*g" % (p, x))
        if struct.pack("<f", candidate) == packed:
            return _plain(candidate)
    return _plain(x)


def _double_text(x: float) -> str:
    return _plain(x)


# Type id (NodeAttribute.cs AttributeType) -> (name, struct format) of the fixed-size numeric types.
_NUMERIC = {
    1: ("Byte", "<B"),
    2: ("Short", "<h"),
    3: ("UShort", "<H"),
    4: ("Int", "<i"),
    5: ("UInt", "<I"),
    24: ("ULongLong", "<Q"),
    26: ("Long", "<q"),
    27: ("Int8", "<b"),
    32: ("Int64", "<q"),
}
_VECTORS = {  # floats, in file order (matrices: column by column, as LSLib reads them)
    6: ("Float", 1),
    11: ("Vec2", 2),
    12: ("Vec3", 3),
    13: ("Vec4", 4),
    14: ("Mat2", 4),
    15: ("Mat3", 9),
    16: ("Mat3x4", 12),
    17: ("Mat4x3", 12),
    18: ("Mat4", 16),
}
_INT_VECTORS = {8: ("IVec2", 2), 9: ("IVec3", 3), 10: ("IVec4", 4)}
_STRINGS = {20: "String", 21: "Path", 22: "FixedString", 23: "LSString", 29: "WString", 30: "LSWString"}


def _string(value: bytes) -> str:
    """LSFReader.ReadString(reader, length): zero-terminated, trailing zero bytes removed."""
    if not value or value[-1] != 0:
        raise ValueError("LSF string is not null-terminated")
    return value[:-1].rstrip(b"\0").decode("utf-8")


def _expect(type_id: int, value: bytes, size: int) -> None:
    if len(value) != size:
        raise ValueError(f"LSF attribute of type {type_id} has length {len(value)}, expected {size}")


def _attribute(type_id: int, value: bytes) -> str:
    """Attribute value as the LSX text shows it; a TranslatedString gives its handle."""
    if type_id in _STRINGS:
        return _string(value)
    if type_id == 28:  # TranslatedString (LSF version >= 4): version (u16), handle length (i32), handle
        (length,) = struct.unpack_from("<i", value, 2)
        if 6 + length != len(value):
            raise ValueError(f"LSF TranslatedString handle length {length} does not fit its {len(value)} bytes")
        return _string(value[6:])
    if type_id == 31:  # UUID
        _expect(type_id, value, 16)
        return guid(value)
    if type_id == 19:  # Bool
        _expect(type_id, value, 1)
        return "true" if value[0] else "false"
    if type_id in _NUMERIC:
        fmt = _NUMERIC[type_id][1]
        _expect(type_id, value, struct.calcsize(fmt))
        return str(struct.unpack(fmt, value)[0])
    if type_id == 7:  # Double
        _expect(type_id, value, 8)
        return _double_text(struct.unpack("<d", value)[0])
    if type_id in _VECTORS:
        count = _VECTORS[type_id][1]
        _expect(type_id, value, 4 * count)
        return " ".join(float32_text(x) for x in struct.unpack(f"<{count}f", value))
    if type_id in _INT_VECTORS:
        count = _INT_VECTORS[type_id][1]
        _expect(type_id, value, 4 * count)
        return " ".join(str(x) for x in struct.unpack(f"<{count}i", value))
    raise ValueError(f"LSF attribute type {type_id} is not supported")


def _names(s: bytes) -> list[list[str]]:
    """Static string hash table: bucket count (u32), then per bucket a count (u16) of (length u16, UTF-8)."""
    (buckets,) = struct.unpack_from("<I", s, 0)
    i = 4
    names = []
    for _ in range(buckets):
        (count,) = struct.unpack_from("<H", s, i)
        i += 2
        bucket = []
        for _ in range(count):
            (length,) = struct.unpack_from("<H", s, i)
            i += 2
            if i + length > len(s):
                raise IndexError("LSF name past the end of the string table")
            bucket.append(s[i : i + length].decode("utf-8"))
            i += length
        names.append(bucket)
    return names


def _name(names: list[list[str]], ref: int) -> str:
    return names[ref >> 16][ref & 0xFFFF]


def _sections(data: bytes):
    """(version, compression flags, metadata format, [(stored bytes, uncompressed size, chunked)] for strings,
    nodes, attributes, values, and keys when present)."""
    if len(data) < 8:
        raise ValueError(f"truncated LSF: {len(data)} bytes, no header")
    magic, version = struct.unpack_from("<4sI", data, 0)
    if magic != MAGIC:
        raise ValueError(f"not an LSF resource: magic {magic!r}, expected {MAGIC!r}")
    if version not in VERSIONS:
        raise ValueError(f"LSF version {version} is not supported (supported: {', '.join(map(str, VERSIONS))})")
    i = 8 + 8  # LSFHeaderV5: engine version (i64)
    if version >= 6:  # LSFMetadataV6
        fmt = "<10IBBHI"
    else:  # LSFMetadataV5: no keys section
        fmt = "<8IBBHI"
    if len(data) < i + struct.calcsize(fmt):
        raise ValueError(f"truncated LSF: {len(data)} bytes, header incomplete")
    fields = struct.unpack_from(fmt, data, i)
    i += struct.calcsize(fmt)
    if version >= 6:
        strings, keys, nodes, attributes, values = (fields[k : k + 2] for k in range(0, 10, 2))
    else:
        strings, nodes, attributes, values = (fields[k : k + 2] for k in range(0, 8, 2))
        keys = (0, 0)
    flags, metadata_format = fields[-4], fields[-1]
    compressed = (flags & 0x0F) != 0
    order = [(strings, False), (nodes, True), (attributes, True), (values, True)]
    if metadata_format == _KEYS_AND_ADJACENCY:
        order.append((keys, True))
    res = []
    for (uncompressed, on_disk), chunkable in order:
        # LSFReader.Decompress: size on disk 0 means stored as is; otherwise compressed when the flags say so.
        size = uncompressed if on_disk == 0 or not compressed else on_disk
        if i + size > len(data):
            raise ValueError(f"truncated LSF: section of {size} bytes at {i}, file has {len(data)}")
        res.append((data[i : i + size], uncompressed, on_disk != 0 and compressed, chunkable))
        i += size
    return version, flags, metadata_format, res


def _section(stored: bytes, size: int, compressed: bool, chunked: bool, flags: int) -> bytes:
    if not compressed:
        return stored
    if chunked and (flags & 0x0F) == _LZ4:  # Compression.cs: chunked LZ4 is a frame
        out = lz4_frame(stored)
    elif (flags & 0x0F) == _LZ4:
        out = bytearray()
        _lz4_into(stored, out)
        out = bytes(out)
    else:
        out = decompress(stored, flags, size)
    if len(out) != size:
        raise ValueError(f"LSF section decompressed to {len(out)} bytes, expected {size}")
    return out


def read(data: bytes) -> list[Node]:
    """Root-level nodes of every region (the children of each region's node), in file order."""
    try:
        return _read(data)
    except (struct.error, IndexError, UnicodeDecodeError) as e:
        raise ValueError(f"truncated or malformed LSF data: {e}") from None


def nodes(data: bytes, node_type: str) -> list[Node]:
    """Root-level nodes of this type, in file order (as lsx.nodes does for an LSX file)."""
    return [n for n in read(data) if n["id"] == node_type]


def _read(data: bytes) -> list[Node]:
    version, flags, metadata_format, sections = _sections(data)
    # Version >= 2 (VerChunkedCompress): every section but the strings may be chunked.
    strings_s, nodes_s, attributes_s, values_s = (_section(s, u, c, ch, flags) for s, u, c, ch in sections[:4])
    names = _names(strings_s)
    long = version >= 3 and metadata_format == _KEYS_AND_ADJACENCY  # VerExtendedNodes and KeysAndAdjacency

    # Node table: V3 (name, parent, next sibling, first attribute) or V2 (name, first attribute, parent).
    node_info = []  # (name ref, parent, first attribute)
    if long:
        if len(nodes_s) % 16:
            raise ValueError(f"truncated LSF: node table of {len(nodes_s)} bytes is not a multiple of 16")
        node_info = [(ref, parent, first) for ref, parent, _, first in struct.iter_unpack("<Iiii", nodes_s)]
    else:
        if len(nodes_s) % 12:
            raise ValueError(f"truncated LSF: node table of {len(nodes_s)} bytes is not a multiple of 12")
        node_info = [(ref, parent, first) for ref, first, parent in struct.iter_unpack("<Iii", nodes_s)]

    # Attribute table: (name ref, type id, length, value offset, next attribute).
    attributes = []
    if long:
        if len(attributes_s) % 16:
            raise ValueError(f"truncated LSF: attribute table of {len(attributes_s)} bytes is not a multiple of 16")
        for ref, type_and_length, following, offset in struct.iter_unpack("<IIiI", attributes_s):
            attributes.append([ref, type_and_length & 0x3F, type_and_length >> 6, offset, following])
    else:
        if len(attributes_s) % 12:
            raise ValueError(f"truncated LSF: attribute table of {len(attributes_s)} bytes is not a multiple of 12")
        # ReadAttributesV2: values follow each other; each attribute links to the next one of the same node.
        previous: dict[int, int] = {}
        offset = 0
        for index, (ref, type_and_length, node_index) in enumerate(struct.iter_unpack("<IIi", attributes_s)):
            length = type_and_length >> 6
            attributes.append([ref, type_and_length & 0x3F, length, offset, -1])
            if node_index in previous:
                attributes[previous[node_index]][4] = index
            previous[node_index] = index
            offset += length

    roots: list[Node] = []
    instances: list[Node] = []
    for index, (ref, parent, first) in enumerate(node_info):
        values = {}
        a = first
        seen = 0
        while a != -1:
            if not 0 <= a < len(attributes) or seen > len(attributes):
                raise ValueError(f"LSF node {index}: bad attribute index {a}")
            name_ref, type_id, length, offset, following = attributes[a]
            if offset + length > len(values_s):
                raise ValueError(f"truncated LSF: attribute value at {offset}+{length} past the {len(values_s)} bytes of values")
            name = _name(names, name_ref)
            try:
                values[name] = _attribute(type_id, values_s[offset : offset + length])
            except ValueError as e:
                raise ValueError(f"LSF node {_name(names, ref)}, attribute {name}: {e}") from None
            a = following
            seen += 1
        node = {"id": _name(names, ref), "attributes": values, "children": []}
        if parent == -1:  # a region: its node stands for the LSX region's root node
            instances.append(node)
            roots.append(node)
        else:
            if not 0 <= parent < index:
                raise ValueError(f"LSF node {index}: parent {parent} is not an earlier node")
            instances[parent]["children"].append(node)
            instances.append(node)
    return [child for region in roots for child in region["children"]]
