"""Builders of synthetic files for the tests: LSPK v18 paks, .loca tables and LSF resources, with no Larian content."""
import atexit
import struct
import tempfile
import uuid
from pathlib import Path

_folder = tempfile.TemporaryDirectory(prefix="bg3-tests-")
atexit.register(_folder.cleanup)
_counter = 0


def write_tmp(data: bytes) -> Path:
    """Write the bytes to a temporary file, deleted when the process ends."""
    global _counter
    _counter += 1
    path = Path(_folder.name) / f"file-{_counter}.bin"
    path.write_bytes(data)
    return path


def lz4_literals(data: bytes) -> bytes:
    """LZ4 "literals only" block: a token, the extension bytes if n >= 15, then the literals."""
    n = len(data)
    out = bytearray([min(n, 15) << 4])
    if n >= 15:
        rest = n - 15
        while rest >= 255:
            out.append(255)
            rest -= 255
        out.append(rest)
    return bytes(out) + data


def pak(files: dict[str, bytes], parts: dict[str, int] | None = None) -> bytes:
    """LSPK v18 pak: uncompressed files, table in LZ4 "literals only"; `parts` sets a file's archive part (default 0)."""
    body = bytearray()
    table = bytearray()
    start = 20
    for name, content in files.items():
        position = start + len(body)
        table += name.encode("utf-8").ljust(256, b"\0")
        table += struct.pack("<IHBBII", position & 0xFFFFFFFF, position >> 32, (parts or {}).get(name, 0), 0, len(content), len(content))
        body += content
    table_lz4 = lz4_literals(bytes(table))
    header = struct.pack("<4sIQI", b"LSPK", 18, start + len(body), 0)
    return header + bytes(body) + struct.pack("<II", len(files), len(table_lz4)) + table_lz4


def loca(entries: list[tuple[str, int, str]]) -> bytes:
    """Binary .loca table: LOCA header, 70-byte entries, then the texts (zero-terminated)."""
    texts = [t.encode("utf-8") + b"\0" for _, _, t in entries]
    texts_position = 12 + 70 * len(entries)
    out = bytearray(struct.pack("<4sII", b"LOCA", len(entries), texts_position))
    for (key, version, _), text in zip(entries, texts):
        out += key.encode("utf-8").ljust(64, b"\0") + struct.pack("<HI", version, len(text))
    return bytes(out) + b"".join(texts)


# LSX type name -> (LSF type id, encoder of the LSX text); strings are written by `_lsf_value`.
_LSF_TYPES = {
    "uint8": (1, lambda t: struct.pack("<B", int(t))),
    "int16": (2, lambda t: struct.pack("<h", int(t))),
    "uint16": (3, lambda t: struct.pack("<H", int(t))),
    "int32": (4, lambda t: struct.pack("<i", int(t))),
    "uint32": (5, lambda t: struct.pack("<I", int(t))),
    "float": (6, lambda t: struct.pack("<f", float(t))),
    "double": (7, lambda t: struct.pack("<d", float(t))),
    "ivec2": (8, lambda t: struct.pack("<2i", *map(int, t.split()))),
    "fvec2": (11, lambda t: struct.pack("<2f", *map(float, t.split()))),
    "fvec3": (12, lambda t: struct.pack("<3f", *map(float, t.split()))),
    "fvec4": (13, lambda t: struct.pack("<4f", *map(float, t.split()))),
    "mat3x3": (15, lambda t: struct.pack("<9f", *map(float, t.split()))),
    "mat4x4": (18, lambda t: struct.pack("<16f", *map(float, t.split()))),
    "bool": (19, lambda t: bytes([t == "true"])),
    "FixedString": (22, None),
    "LSString": (23, None),
    "uint64": (24, lambda t: struct.pack("<Q", int(t))),
    "ScratchBuffer": (25, lambda t: bytes.fromhex(t)),
    "int8": (27, lambda t: struct.pack("<b", int(t))),
    "TranslatedString": (28, None),
    "guid": (31, None),
    "int64": (32, lambda t: struct.pack("<q", int(t))),
}


def _lsf_value(kind: str, text: str) -> tuple[int, bytes]:
    type_id, encode = _LSF_TYPES[kind]
    if kind in ("FixedString", "LSString"):
        return type_id, text.encode("utf-8") + b"\0"
    if kind == "TranslatedString":  # version (u16), then the handle with its length and terminator
        handle = text.encode("utf-8") + b"\0"
        return type_id, struct.pack("<Hi", 1, len(handle)) + handle
    if kind == "guid":  # inverse of LSLib's reading: .NET Guid byte order, then pairs 8..15 swapped
        raw = bytearray(uuid.UUID(text).bytes_le)
        for i in range(8, 16, 2):
            raw[i], raw[i + 1] = raw[i + 1], raw[i]
        return type_id, bytes(raw)
    return type_id, encode(text)


def lz4_frame_literals(data: bytes) -> bytes:
    """LZ4 frame (linked blocks, no checksums) whose 64 KiB blocks are "literals only" LZ4 blocks."""
    out = bytearray(struct.pack("<I", 0x184D2204) + bytes([0x40, 0x40, 0x00]))
    for start in range(0, len(data), 0x10000):
        block = lz4_literals(data[start : start + 0x10000])
        out += struct.pack("<I", len(block)) + block
    return bytes(out + struct.pack("<I", 0))


def lsf(regions: dict[str, list[dict]], version: int = 7, compressed: bool = False, metadata_format: int = 2) -> bytes:
    """Binary LSF (LSOF) resource. Each region is a node named after it whose children are the given nodes;
    nodes are {"id", "attributes": {id: (LSX type, LSX text)}, "children"}. metadata_format 1 writes the
    long (V3) node and attribute tables and a keys section (empty), 0 and 2 (the game's choice) the V2 tables;
    `compressed` writes LZ4 sections (strings as a block, the others as frames)."""
    names: list[str] = []

    def name_ref(name: str) -> int:
        if name not in names:
            names.append(name)
        i = names.index(name)
        return (i % 3) << 16 | (i // 3)  # three hash buckets, to exercise the (bucket, offset) addressing

    flat = []  # (name, attributes, parent index), parents before their children

    def walk(name: str, attributes: dict, children: list[dict], parent: int) -> None:
        index = len(flat)
        flat.append((name, attributes, parent))
        for c in children:
            walk(c["id"], c["attributes"], c["children"], index)

    for region, nodes in regions.items():
        walk(region, {}, nodes, -1)

    long = version >= 3 and metadata_format == 1
    node_table = bytearray()
    attribute_table = bytearray()
    values = bytearray()
    attribute_index = 0
    last_child: dict[int, int] = {}
    sibling_slots: list[int] = []
    for index, (name, attributes, parent) in enumerate(flat):
        first = attribute_index if attributes else -1
        if long:
            if parent in last_child:  # patch the previous sibling's NextSiblingIndex
                struct.pack_into("<i", node_table, sibling_slots[last_child[parent]], index)
            last_child[parent] = index
            sibling_slots.append(len(node_table) + 8)
            node_table += struct.pack("<Iiii", name_ref(name), parent, -1, first)
        else:
            node_table += struct.pack("<Iii", name_ref(name), first, parent)
        items = list(attributes.items())
        for k, (key, (kind, text)) in enumerate(items):
            type_id, value = _lsf_value(kind, text)
            type_and_length = type_id | (len(value) << 6)
            if long:
                following = attribute_index + 1 if k + 1 < len(items) else -1
                attribute_table += struct.pack("<IIiI", name_ref(key), type_and_length, following, len(values))
            else:
                attribute_table += struct.pack("<IIi", name_ref(key), type_and_length, index)
            values += value
            attribute_index += 1

    buckets: list[list[str]] = [[], [], []]
    for i, name in enumerate(names):
        buckets[i % 3].append(name)
    strings = bytearray(struct.pack("<I", len(buckets)))
    for bucket in buckets:
        strings += struct.pack("<H", len(bucket))
        for name in bucket:
            encoded = name.encode("utf-8")
            strings += struct.pack("<H", len(encoded)) + encoded

    keys = b"" if version >= 6 and metadata_format == 1 else None
    sections = [bytes(strings), bytes(node_table), bytes(attribute_table), bytes(values)]
    if keys is not None:
        sections.append(keys)
    stored = []
    for i, section in enumerate(sections):
        if not compressed or not section:
            stored.append((len(section), 0, section))
        elif i == 0:
            block = lz4_literals(section)
            stored.append((len(section), len(block), block))
        else:
            frame = lz4_frame_literals(section)
            stored.append((len(section), len(frame), frame))

    sizes = [(u, d) for u, d, _ in stored]
    flags = 0x22 if compressed else 0
    out = bytearray(struct.pack("<4sI", b"LSOF", version))
    out += struct.pack("<q", 0) if version >= 5 else struct.pack("<i", 0)
    if version >= 6:
        keys_size = sizes[4] if keys is not None else (0, 0)
        order = [sizes[0], keys_size, sizes[1], sizes[2], sizes[3]]
        out += b"".join(struct.pack("<II", u, d) for u, d in order)
    else:
        out += b"".join(struct.pack("<II", u, d) for u, d in sizes[:4])
    out += struct.pack("<BBHI", flags, 0, 0, metadata_format)
    return bytes(out) + b"".join(s for _, _, s in stored)
