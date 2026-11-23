import re
import tempfile
import unittest
from pathlib import Path

from scripts.donnees import sources
from tests.donnees import fabrique

MOTIF = re.compile(r"Lists/SpellLists\.lsx$")


def _liste(module: str, contenu: bytes) -> dict[str, bytes]:
    return {f"Public/{module}/Lists/SpellLists.lsx": contenu}


class TestSources(unittest.TestCase):
    def _jeu(self, paks: dict[str, dict[str, bytes]]) -> Path:
        dossier = tempfile.TemporaryDirectory()
        self.addCleanup(dossier.cleanup)
        jeu = Path(dossier.name)
        (jeu / "Data").mkdir()
        for nom, fichiers in paks.items():
            (jeu / "Data" / nom).write_bytes(fabrique.pak(fichiers))
        return jeu

    def _paks_de_base(self, correctif: dict[str, bytes] | None = None) -> dict[str, dict[str, bytes]]:
        return {
            "Shared.pak": {**_liste("Shared", b"shared"), **_liste("SharedDev", b"sharedDev")},
            "GustavX.pak": {**_liste("GustavX", b"gustavx"), **_liste("HonourX", b"honourx")},
            "Gustav.pak": _liste("Honour", b"honour"),
            "BetterTooltips.pak": _liste("Shared", b"mod"),
            "Patch8_HotFix9.pak": correctif or {"Public/Shared/Autre.txt": b"x"},
            "Patch8_HotFix10.pak": {},
        }

    def test_ordre_et_exclusions(self):
        jeu = self._jeu(self._paks_de_base())
        c = sources.couches(jeu, MOTIF)
        self.assertEqual([m for m, _, _ in c], ["Shared", "SharedDev", "GustavX"])
        self.assertEqual([p for _, p, _ in c], ["Lists/SpellLists.lsx"] * 3)
        self.assertNotIn(b"mod", b"".join(d for _, _, d in c))

    def test_correctif_qui_touche_les_regles(self):
        jeu = self._jeu(self._paks_de_base(_liste("Shared", b"patch")))
        with self.assertRaises(sources.SourceInattendue):
            sources.couches(jeu, MOTIF)

    def test_pak_de_regles_absent(self):
        paks = self._paks_de_base()
        del paks["Gustav.pak"]
        with self.assertRaises(sources.SourceInattendue):
            sources.couches(self._jeu(paks), MOTIF)

    def test_correctifs_absents_toleres(self):
        paks = self._paks_de_base()
        del paks["Patch8_HotFix9.pak"], paks["Patch8_HotFix10.pak"]
        c = sources.couches(self._jeu(paks), MOTIF)
        self.assertEqual(len(c), 3)


if __name__ == "__main__":
    unittest.main()
