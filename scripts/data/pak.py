"""Read-only access to the game's LSPK archives (v16 and v18)."""
import struct
import zlib
from collections.abc import Callable
from pathlib import Path


# Adapted from pakmeta.py (the user's own code), under GPL-3.0-or-later.
def lz4_block(src: bytes, size: int) -> bytes:
    out = bytearray()
    i = 0
    while i < len(src):
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
        out += src[i : i + lit]
        i += lit
        if i >= len(src) or len(out) >= size:
            break
        off = src[i] | (src[i + 1] << 8)
        i += 2
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
        for k in range(ml):
            out.append(out[start + k])
    return bytes(out)


# Adapted from pakmeta.py (the user's own code), under GPL-3.0-or-later.
def decompress(data: bytes, flags: int, size: int) -> bytes:
    method = flags & 0x0F
    if method == 0:
        return data
    if method == 1:
        return zlib.decompress(data)
    if method == 2:
        return lz4_block(data, size)
    if method == 3:
        from compression import zstd

        return zstd.decompress(data)
    raise ValueError(f"unknown compression: {method}")


# Adapted from pakmeta.py (the user's own code), under GPL-3.0-or-later.
def pak_entries(f):
    """Yield (name, position, part, flags, size on disk, size) for each file of an LSPK v16 or v18 pak."""
    magic, version, table_position, _ = struct.unpack("<4sIQI", f.read(20))
    if magic != b"LSPK" or version not in (16, 18):
        raise ValueError(f"unsupported pak: {magic!r} v{version}")
    entry_size = 272 if version == 18 else 296
    f.seek(table_position)
    count, compressed = struct.unpack("<II", f.read(8))
    table = lz4_block(f.read(compressed), count * entry_size)
    for n in range(count):
        entry = table[n * entry_size : (n + 1) * entry_size]
        name = entry[:256].split(b"\0", 1)[0].decode("utf-8", "replace")
        if version == 18:
            low, high, part, flags, on_disk, size = struct.unpack("<IHBBII", entry[256:272])
            position = low | (high << 32)
        else:
            position, on_disk, size, part, flags = struct.unpack("<QQQII", entry[256:288])
        yield name, position, part, flags, on_disk, size


def read_pak(path: Path, predicate: Callable[[str], bool]) -> dict[str, bytes]:
    """Decompressed files of the pak whose name passes the predicate; files from another part are skipped."""
    files = {}
    with open(path, "rb") as f:
        for name, position, part, flags, on_disk, size in list(pak_entries(f)):
            if part != 0 or not predicate(name):
                continue
            f.seek(position)
            files[name] = decompress(f.read(on_disk), flags, size)
    return files
