import tempfile
import unittest
from pathlib import Path

from scripts.data import lsx, origins
from tests.data.test_importer import lsx as lsx_file

RULES = {
    "classes": {"Cleric": {"uuid": "c-cleric", "parent": None}, "Trickery": {"uuid": "c-trick", "parent": "Cleric"},
                "Fighter": {"uuid": "c-fighter", "parent": None}},
    "races": {"HalfElf": {"uuid": "r-halfelf", "parent": None}, "HalfElf_High": {"uuid": "r-high", "parent": "HalfElf"}},
    "backgrounds": {"b-acolyte": {}},
}
SCORES = {"Strength": "12", "Dexterity": "13", "Constitution": "14", "Intelligence": "10", "Wisdom": "15",
          "Charisma": "8"}


def preset(uuid: str, class_uuid: str, **scores: str) -> dict:
    return {"UUID": uuid, "ClassUUID": class_uuid, **{**SCORES, **scores}}


PRESETS = lsx.merge([lsx.nodes(lsx_file("AbilityDistributionPreset", preset("a-cleric", "c-cleric", Wisdom="14"),
                                        preset("a-trick", "c-trick"), preset("a-fighter", "c-fighter")),
                               "AbilityDistributionPreset")])


def origin(**attributes: str) -> dict:
    return {"UUID": "o-sh", "Name": "Shadowheart", "ClassUUID": "c-cleric", "SubClassUUID": "c-trick",
            "RaceUUID": "r-halfelf", "SubRaceUUID": "r-high", "BackgroundUUID": "b-acolyte", "LockRace": "true",
            "DisplayName": "hShadowheart;1", "Description": "hShadowheartDesc;2", **attributes}


def merged(*layers: list[dict]) -> dict:
    return lsx.merge([lsx.nodes(lsx_file("Origin", *layer), "Origin") for layer in layers])


class OriginsTest(unittest.TestCase):
    def test_later_module_wins_and_names_are_resolved(self):
        nodes = merged([origin(ClassUUID="c-fighter", SubClassUUID="", LockRace="false")], [origin()])
        result, errors = origins.build(nodes, PRESETS, RULES, {})
        self.assertEqual(errors, [])
        self.assertEqual(result, {"Shadowheart": {
            "class": "Cleric", "subclass": "Trickery", "race": "HalfElf", "subrace": "HalfElf_High",
            "background": "b-acolyte", "lockRace": True,
            "abilities": {"Strength": 12, "Dexterity": 13, "Constitution": 14, "Intelligence": 10, "Wisdom": 15,
                          "Charisma": 8},
            "text": {"name": "hShadowheart", "description": "hShadowheartDesc"}}})

    def test_preset_of_the_class_without_subclass_preset(self):
        nodes = merged([origin(SubClassUUID="00000000-0000-0000-0000-000000000000")])
        result, errors = origins.build(nodes, PRESETS, RULES, {})
        self.assertEqual(errors, [])
        self.assertIsNone(result["Shadowheart"]["subclass"])
        self.assertEqual(result["Shadowheart"]["abilities"]["Wisdom"], 14)

    def test_origin_without_class(self):
        nodes = merged([{"UUID": "o-gen", "Name": "Generic", "DisplayName": "hCustom;1"}])
        result, errors = origins.build(nodes, PRESETS, RULES, {})
        self.assertEqual(errors, [])
        self.assertEqual(result["Generic"], {"class": None, "subclass": None, "race": None, "subrace": None,
                                             "background": None, "lockRace": False, "abilities": None,
                                             "text": {"name": "hCustom", "description": None}})

    def test_excluded_origin_is_left_out(self):
        nodes = merged([origin(), origin(UUID="o-dbg", Name="Debug", ClassUUID="c-unknown")])
        result, errors = origins.build(nodes, PRESETS, RULES, {"Debug": "test origin"})
        self.assertEqual(errors, [])
        self.assertEqual(sorted(result), ["Shadowheart"])

    def test_every_problem_is_listed(self):
        nodes = merged([origin(SubRaceUUID="r-hidden", BackgroundUUID="b-none", LockRace="maybe"),
                        origin(UUID="o-2", Name="Twin"), origin(UUID="o-3", Name="Twin"),
                        origin(UUID="o-4", Name="")])
        presets = lsx.merge([lsx.nodes(lsx_file("AbilityDistributionPreset", preset("a-1", "c-trick")),
                                       "AbilityDistributionPreset")])
        result, errors = origins.build(nodes, presets, {**RULES, "classes": {**RULES["classes"]}},
                                       {"Gone": "stale entry"})
        joined = "\n".join(errors)
        for word in ("Shadowheart: SubRaceUUID r-hidden", "Shadowheart: BackgroundUUID b-none", "LockRace",
                     "duplicate origin Name Twin", "o-4: missing Name", "Gone"):
            self.assertIn(word, joined)

    def test_class_without_preset_is_an_error(self):
        nodes = merged([origin(ClassUUID="c-fighter", SubClassUUID="")])
        presets = lsx.merge([lsx.nodes(lsx_file("AbilityDistributionPreset", preset("a-1", "c-trick")),
                                       "AbilityDistributionPreset")])
        _, errors = origins.build(nodes, presets, RULES, {})
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("no ability preset", errors[0])

    def test_two_presets_for_one_class_is_an_error(self):
        presets = lsx.merge([lsx.nodes(lsx_file("AbilityDistributionPreset", preset("a-1", "c-trick"),
                                                preset("a-2", "c-trick")), "AbilityDistributionPreset")])
        _, errors = origins.build(merged([origin()]), presets, RULES, {})
        self.assertIn("c-trick", "\n".join(errors))


class ReadExcludedTest(unittest.TestCase):
    def test_format(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "origins_excluded.txt"
            path.write_text("# header\nDarkUrge-Debug  # debug copy\n", encoding="utf-8")
            self.assertEqual(origins.read_excluded(path), {"DarkUrge-Debug": "debug copy"})
            for bad in ("DarkUrge-Debug\n", "Two words  # reason\n", "A  # r\nA  # r\n"):
                path.write_text(bad, encoding="utf-8")
                with self.subTest(bad), self.assertRaises(ValueError):
                    origins.read_excluded(path)

    def test_committed_file_reads(self):
        self.assertIsInstance(origins.read_excluded(origins.ORIGINS_EXCLUDED), dict)


if __name__ == "__main__":
    unittest.main()
