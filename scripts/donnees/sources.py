"""Choix des sources : quels paks et quels modules l'import lit, dans quel ordre de surcharge."""
import re
from pathlib import Path

from scripts.donnees.pak import lire_pak

PAKS_REGLES = ("Shared.pak", "Gustav.pak", "GustavX.pak")
PAKS_CORRECTIFS = ("Patch8_HotFix9.pak", "Patch8_HotFix10.pak")
# Ordre de surcharge tiré des meta.lsx : le dernier l'emporte. Honour et HonourX (mode Honneur) sont exclus.
MODULES = ("Shared", "SharedDev", "Gustav", "GustavDev", "GustavX")

_CHEMIN = re.compile(r"Public/([^/]+)/(.+)$")


class SourceInattendue(Exception):
    """Un pak attendu manque, ou un correctif touche des fichiers de règles."""


def _filtre(motif: re.Pattern, modules: tuple[str, ...] | None):
    def accepte(nom: str) -> bool:
        m = _CHEMIN.match(nom)
        return bool(m) and (modules is None or m[1] in modules) and bool(motif.search(m[2]))
    return accepte


def couches(jeu: Path, motif: re.Pattern) -> list[tuple[str, str, bytes]]:
    """(module, chemin relatif au module, contenu) des fichiers `Public/<module>/<chemin>` dont le chemin
    correspond au motif, triés par rang du module dans MODULES puis par chemin."""
    data = jeu / "Data"
    for nom in PAKS_CORRECTIFS:
        chemin = data / nom
        if chemin.exists():
            touches = lire_pak(chemin, _filtre(motif, None))
            if touches:
                raise SourceInattendue(f"{nom} contient des fichiers de règles : {sorted(touches)}")
    trouves = []
    for nom in PAKS_REGLES:
        chemin = data / nom
        if not chemin.exists():
            raise SourceInattendue(f"pak de règles introuvable : {chemin}")
        for fichier, contenu in lire_pak(chemin, _filtre(motif, MODULES)).items():
            module, relatif = _CHEMIN.match(fichier).groups()
            trouves.append((module, relatif, contenu))
    trouves.sort(key=lambda t: (MODULES.index(t[0]), t[1]))
    return trouves
