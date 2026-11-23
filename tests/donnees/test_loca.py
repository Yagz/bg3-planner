import unittest

from scripts.donnees import loca
from tests.donnees import fabrique
from tests.donnees.fabrique import ecrire_tmp


class TestLoca(unittest.TestCase):
    def test_version_la_plus_haute(self):
        d = fabrique.loca([("h1", 1, "Old"), ("h1", 2, "New"), ("h2", 1, "Deux")])
        self.assertEqual(loca.lire_loca(d), {"h1": (2, "New"), "h2": (1, "Deux")})

    def test_table_depuis_un_pak(self):
        p = ecrire_tmp(fabrique.pak({"Localization/French/french.loca": fabrique.loca([("h1", 1, "Rôdeur")])}))
        self.assertEqual(loca.table(p, "French"), {"h1": "Rôdeur"})

    def test_a_version_egale_la_derniere_entree_l_emporte(self):
        d = fabrique.loca([("h1", 1, "A"), ("h1", 1, "B")])
        self.assertEqual(loca.lire_loca(d), {"h1": (1, "B")})

    def test_a_version_egale_le_dernier_fichier_trie_l_emporte(self):
        p = ecrire_tmp(fabrique.pak({
            "Localization/French/b.loca": fabrique.loca([("h1", 1, "B")]),
            "Localization/French/a.loca": fabrique.loca([("h1", 1, "A")]),
        }))
        self.assertEqual(loca.table(p, "French"), {"h1": "B"})
