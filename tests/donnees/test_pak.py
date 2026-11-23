import unittest

from scripts.donnees import pak
from tests.donnees import fabrique
from tests.donnees.fabrique import ecrire_tmp


class TestPak(unittest.TestCase):
    def test_lit_les_fichiers_filtres(self):
        p = ecrire_tmp(fabrique.pak({"Public/A/x.lsx": b"<a/>", "Public/B/y.txt": b"yy"}))
        self.assertEqual(pak.lire_pak(p, lambda n: n.endswith(".lsx")), {"Public/A/x.lsx": b"<a/>"})

    def test_lz4_litteraux_longs(self):  # longueur > 15 : octets d'extension
        donnees = bytes(range(256)) * 3
        self.assertEqual(pak.lz4_block(fabrique.lz4_litteraux(donnees), len(donnees)), donnees)

    def test_refuse_un_format_inconnu(self):
        with self.assertRaises(ValueError):
            pak.lire_pak(ecrire_tmp(b"XXXX" + bytes(16)), lambda n: True)
