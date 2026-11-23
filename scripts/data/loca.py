"""Reading the game's .loca translation tables."""
import re
import struct
from pathlib import Path

from scripts.data.pak import read_pak


# Adapted from commun.py (the user's own code), under GPL-3.0-or-later.
def loca_entries(b: bytes) -> list[tuple[str, int, str]]:
    """[(identifier, version, text)] of a binary .loca."""
    if b[:4] != b"LOCA":
        raise ValueError("invalid .loca table: LOCA signature missing")
    n, texts_position = struct.unpack("<II", b[4:12])
    res = []
    pos = 12
    tp = texts_position
    for _ in range(n):
        key = b[pos : pos + 64].split(b"\0", 1)[0].decode()
        version, length = struct.unpack("<HI", b[pos + 64 : pos + 70])
        pos += 70
        res.append((key, version, b[tp : tp + length].rstrip(b"\0").decode("utf-8", "replace")))
        tp += length
    return res


def _merge(res: dict[str, tuple[int, str]], entries) -> None:
    """Add the entries to res: the highest version wins, on equal versions the last occurrence."""
    for key, version, text in entries:
        if key not in res or version >= res[key][0]:
            res[key] = (version, text)


def read_loca(data: bytes) -> dict[str, tuple[int, str]]:
    """identifier -> (version, text); the highest version wins, on a tie the last entry."""
    res: dict[str, tuple[int, str]] = {}
    _merge(res, loca_entries(data))
    return res


def table(pak_path: Path, language: str) -> dict[str, str]:
    """Merge of all Localization/<language>/*.loca in the pak: identifier -> text (on a tie, the last sorted file)."""
    pattern = re.compile(rf"Localization/{re.escape(language)}/[^/]+\.loca", re.IGNORECASE)
    res: dict[str, tuple[int, str]] = {}
    for name, data in sorted(read_pak(pak_path, lambda n: pattern.fullmatch(n) is not None).items()):
        _merge(res, loca_entries(data))
    return {key: text for key, (_, text) in res.items()}
