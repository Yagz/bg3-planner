"""Fabrique de fichiers synthétiques pour les tests : paks LSPK v18 et tables .loca, sans contenu de Larian."""
import atexit
import struct
import tempfile
from pathlib import Path

_dossier = tempfile.TemporaryDirectory(prefix="bg3-tests-")
atexit.register(_dossier.cleanup)
_compteur = 0


def ecrire_tmp(data: bytes) -> Path:
    """Écrit les octets dans un fichier temporaire, supprimé en fin de processus."""
    global _compteur
    _compteur += 1
    chemin = Path(_dossier.name) / f"fichier-{_compteur}.bin"
    chemin.write_bytes(data)
    return chemin


def lz4_litteraux(data: bytes) -> bytes:
    """Bloc LZ4 « littéraux seuls » : un jeton, les octets d'extension si n >= 15, puis les littéraux."""
    n = len(data)
    out = bytearray([min(n, 15) << 4])
    if n >= 15:
        reste = n - 15
        while reste >= 255:
            out.append(255)
            reste -= 255
        out.append(reste)
    return bytes(out) + data


def pak(fichiers: dict[str, bytes]) -> bytes:
    """Pak LSPK v18 : fichiers non compressés, table en LZ4 « littéraux seuls »."""
    corps = bytearray()
    table = bytearray()
    debut = 20
    for nom, contenu in fichiers.items():
        position = debut + len(corps)
        table += nom.encode("utf-8").ljust(256, b"\0")
        table += struct.pack("<IHBBII", position & 0xFFFFFFFF, position >> 32, 0, 0, len(contenu), len(contenu))
        corps += contenu
    table_lz4 = lz4_litteraux(bytes(table))
    entete = struct.pack("<4sIQI", b"LSPK", 18, debut + len(corps), 0)
    return entete + bytes(corps) + struct.pack("<II", len(fichiers), len(table_lz4)) + table_lz4


def loca(entrees: list[tuple[str, int, str]]) -> bytes:
    """Table .loca binaire : en-tête LOCA, entrées de 70 octets, puis les textes (terminés par un zéro)."""
    textes = [t.encode("utf-8") + b"\0" for _, _, t in entrees]
    position_textes = 12 + 70 * len(entrees)
    out = bytearray(struct.pack("<4sII", b"LOCA", len(entrees), position_textes))
    for (cle, version, _), texte in zip(entrees, textes):
        out += cle.encode("utf-8").ljust(64, b"\0") + struct.pack("<HI", version, len(texte))
    return bytes(out) + b"".join(textes)
