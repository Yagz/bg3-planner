"""Lecture des tables de traduction .loca du jeu."""
import re
import struct
from pathlib import Path

from scripts.donnees.pak import lire_pak


# Repris de commun.py (code de l'utilisateur), sous GPL-3.0-or-later.
def loca_entries(b: bytes) -> list[tuple[str, int, str]]:
    """[(identifiant, version, texte)] d'un .loca binaire."""
    if b[:4] != b"LOCA":
        raise ValueError("table .loca invalide : signature LOCA absente")
    n, position_textes = struct.unpack("<II", b[4:12])
    res = []
    pos = 12
    tp = position_textes
    for _ in range(n):
        cle = b[pos : pos + 64].split(b"\0", 1)[0].decode()
        version, longueur = struct.unpack("<HI", b[pos + 64 : pos + 70])
        pos += 70
        res.append((cle, version, b[tp : tp + longueur].rstrip(b"\0").decode("utf-8", "replace")))
        tp += longueur
    return res


def lire_loca(data: bytes) -> dict[str, tuple[int, str]]:
    """identifiant -> (version, texte) ; la version la plus haute l'emporte."""
    res: dict[str, tuple[int, str]] = {}
    for cle, version, texte in loca_entries(data):
        if cle not in res or version > res[cle][0]:
            res[cle] = (version, texte)
    return res


def table(chemin_pak: Path, langue: str) -> dict[str, str]:
    """Fusion de tous les Localization/<langue>/*.loca du pak : identifiant -> texte."""
    motif = re.compile(rf"Localization/{re.escape(langue)}/[^/]+\.loca", re.IGNORECASE)
    res: dict[str, tuple[int, str]] = {}
    for nom, data in sorted(lire_pak(chemin_pak, lambda n: motif.fullmatch(n) is not None).items()):
        for cle, (version, texte) in lire_loca(data).items():
            if cle not in res or version > res[cle][0]:
                res[cle] = (version, texte)
    return {cle: texte for cle, (_, texte) in res.items()}
