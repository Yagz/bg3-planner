"""Builders of synthetic files for the tests: LSPK v18 paks and .loca tables, with no Larian content."""
import atexit
import struct
import tempfile
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
