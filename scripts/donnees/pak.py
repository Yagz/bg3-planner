"""Lecture seule des archives LSPK (v16 et v18) du jeu."""
import struct
import zlib
from collections.abc import Callable
from pathlib import Path


# Repris de pakmeta.py (code de l'utilisateur), sous GPL-3.0-or-later.
def lz4_block(src: bytes, taille: int) -> bytes:
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
        if i >= len(src) or len(out) >= taille:
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


# Repris de pakmeta.py (code de l'utilisateur), sous GPL-3.0-or-later.
def decompress(data: bytes, flags: int, taille: int) -> bytes:
    methode = flags & 0x0F
    if methode == 0:
        return data
    if methode == 1:
        return zlib.decompress(data)
    if methode == 2:
        return lz4_block(data, taille)
    if methode == 3:
        from compression import zstd

        return zstd.decompress(data)
    raise ValueError(f"compression inconnue : {methode}")


# Repris de pakmeta.py (code de l'utilisateur), sous GPL-3.0-or-later.
def pak_entries(f):
    """Rend (nom, position, part, flags, taille sur disque, taille) pour chaque fichier d'un pak LSPK v16 ou v18."""
    magic, version, position_table, _ = struct.unpack("<4sIQI", f.read(20))
    if magic != b"LSPK" or version not in (16, 18):
        raise ValueError(f"pak non pris en charge : {magic!r} v{version}")
    taille_entree = 272 if version == 18 else 296
    f.seek(position_table)
    nombre, compresse = struct.unpack("<II", f.read(8))
    table = lz4_block(f.read(compresse), nombre * taille_entree)
    for n in range(nombre):
        entree = table[n * taille_entree : (n + 1) * taille_entree]
        nom = entree[:256].split(b"\0", 1)[0].decode("utf-8", "replace")
        if version == 18:
            bas, haut, part, flags, sur_disque, taille = struct.unpack("<IHBBII", entree[256:272])
            position = bas | (haut << 32)
        else:
            position, sur_disque, taille, part, flags = struct.unpack("<QQQII", entree[256:288])
        yield nom, position, part, flags, sur_disque, taille


def lire_pak(chemin: Path, filtre: Callable[[str], bool]) -> dict[str, bytes]:
    """Fichiers du pak dont le nom passe le filtre, décompressés ; les fichiers d'une autre part sont ignorés."""
    fichiers = {}
    with open(chemin, "rb") as f:
        for nom, position, part, flags, sur_disque, taille in list(pak_entries(f)):
            if part != 0 or not filtre(nom):
                continue
            f.seek(position)
            fichiers[nom] = decompress(f.read(sur_disque), flags, taille)
    return fichiers
