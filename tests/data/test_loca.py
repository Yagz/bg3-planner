import unittest

from scripts.data import loca
from tests.data import fixtures
from tests.data.fixtures import write_tmp


class TestLoca(unittest.TestCase):
    def test_highest_version_wins(self):
        d = fixtures.loca([("h1", 1, "Old"), ("h1", 2, "New"), ("h2", 1, "Two")])
        self.assertEqual(loca.read_loca(d), {"h1": (2, "New"), "h2": (1, "Two")})

    def test_table_from_a_pak(self):
        p = write_tmp(fixtures.pak({"Localization/French/french.loca": fixtures.loca([("h1", 1, "Rôdeur")])}))
        self.assertEqual(loca.table(p, "French"), {"h1": "Rôdeur"})

    def test_on_equal_version_the_last_entry_wins(self):
        d = fixtures.loca([("h1", 1, "A"), ("h1", 1, "B")])
        self.assertEqual(loca.read_loca(d), {"h1": (1, "B")})

    def test_on_equal_version_the_last_sorted_file_wins(self):
        p = write_tmp(fixtures.pak({
            "Localization/French/b.loca": fixtures.loca([("h1", 1, "B")]),
            "Localization/French/a.loca": fixtures.loca([("h1", 1, "A")]),
        }))
        self.assertEqual(loca.table(p, "French"), {"h1": "B"})
