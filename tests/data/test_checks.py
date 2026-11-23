import copy
import json
import tempfile
import unittest
from pathlib import Path

from scripts.data import checks

COUNTS = {"base_classes": 1, "subclasses": 1, "races": 2, "base_races": 1, "backgrounds": 1,
          "origin_backgrounds": 1, "feats": 1}

RULES = {
    "classes": {
        "Wizard": {"parent": None, "table": "t-wiz", "spell_list": "l-spells"},
        "Evocation": {"parent": "Wizard", "table": "t-evo", "spell_list": None},
    },
    "races": {
        "Elf": {"parent": None, "table": "t-elf"},
        "HighElf": {"parent": "Elf", "table": "t-high"},
    },
    "backgrounds": {"bg-1": {"origin": True, "passives": ["Soldier"]}},
    "feats": {"Alert": {"passives": ["Soldier"], "selectors": [{"function": "AddSpells", "list": "l-spells"}]}},
    "progressions": [
        {"table": "t-wiz", "subclasses": ["Evocation"], "passives_added": ["Soldier"], "passives_removed": [],
         "selectors": [{"list": "l-spells"}]},
        {"table": "t-evo", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
        {"table": "t-elf", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
        {"table": "t-high", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
    ],
    "lists": {"l-spells": {"type": "spells", "items": ["Fireball"]},
              "l-pass": {"type": "passives", "items": ["Soldier"]}},
    "spells": {"Fireball": {}},
    "passives": {"Soldier": {}},
}
KEYS = ["class:Wizard", "class:Evocation", "race:Elf", "race:HighElf", "background:bg-1", "feat:Alert",
        "spell:Fireball", "passive:Soldier"]
META = {"game": "1.0", "modules": ["Shared"], "notice": {"en": "Notice.", "fr": "Mention."}}


def write(folder: Path, rules=RULES, keys=KEYS, meta=META, fr_keys=None):
    texts = {k: {"name": "N", "description": None} for k in keys}
    fr = {k: texts[k] for k in (keys if fr_keys is None else fr_keys)}
    for name, data in (("rules", rules), ("meta", meta), ("texts.en", texts), ("texts.fr", fr)):
        (folder / f"{name}.json").write_text(json.dumps(data), encoding="utf-8")


class ChecksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)

    def problems(self, **kwargs):
        write(self.folder, **kwargs)
        return checks.verify(self.folder, COUNTS, duplicates=[])

    def test_coherent_folder(self):
        self.assertEqual(self.problems(), [])

    def test_missing_french_text(self):
        problems = self.problems(fr_keys=[k for k in KEYS if k != "feat:Alert"])
        self.assertEqual(len(problems), 1)
        self.assertIn("feat:Alert", problems[0])
        self.assertIn("French", problems[0])

    def test_empty_name(self):
        write(self.folder)
        path = self.folder / "texts.en.json"
        texts = json.loads(path.read_text(encoding="utf-8"))
        texts["spell:Fireball"]["name"] = " "
        path.write_text(json.dumps(texts), encoding="utf-8")
        problems = checks.verify(self.folder, COUNTS, duplicates=[])
        self.assertEqual(len(problems), 1)
        self.assertIn("spell:Fireball", problems[0])

    def test_stray_text_key(self):
        problems = self.problems(keys=KEYS + ["spell:Nope"])
        self.assertTrue(any("spell:Nope" in p for p in problems))

    def test_orphan_list(self):
        rules = copy.deepcopy(RULES)
        rules["progressions"][0]["selectors"] = [{"list": "l-missing"}]
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 1)
        self.assertIn("l-missing", problems[0])

    def test_orphan_references_are_all_listed(self):
        rules = copy.deepcopy(RULES)
        rules["classes"]["Evocation"]["parent"] = "Nobody"
        rules["lists"]["l-spells"]["items"] = ["Ghost"]
        rules["progressions"][0]["passives_added"] = ["Phantom"]
        rules["feats"]["Alert"]["passives"] = ["Phantom2"]
        rules["races"]["Elf"]["table"] = "t-none"
        rules["progressions"][0]["subclasses"] = ["Nope"]
        problems = self.problems(rules=rules)
        for needle in ("Nobody", "Ghost", "Phantom", "Phantom2", "t-none", "Nope"):
            self.assertTrue(any(needle in p for p in problems), needle)
        self.assertEqual(problems, sorted(problems))

    def test_unnamed_identifier_is_exempt(self):
        write(self.folder, keys=[k for k in KEYS if k != "passive:Soldier"],
              fr_keys=[k for k in KEYS if k != "passive:Soldier"])
        self.assertEqual(checks.verify(self.folder, COUNTS, unnamed={"passive:Soldier"}, duplicates=[]), [])

    def test_wrong_count(self):
        write(self.folder)
        problems = checks.verify(self.folder, {**COUNTS, "feats": 41}, duplicates=[])
        self.assertEqual(len(problems), 1)
        self.assertIn("feats", problems[0])

    def test_duplicate_progression(self):
        rules = copy.deepcopy(RULES)
        for p, uuid in zip(rules["progressions"], ("p1", "p2", "p3", "p4")):
            p.update(uuid=uuid, level=1, multiclass=False)
        rules["progressions"][1].update(table="t-wiz")
        rules["progressions"].append({**rules["progressions"][1], "table": "t-evo", "uuid": "p5",
                                      "multiclass": True})
        write(self.folder, rules=rules)
        problems = checks.verify(self.folder, COUNTS, duplicates=[])
        self.assertTrue(any("p1" in p and "p2" in p for p in problems), problems)
        self.assertFalse(any("p5" in p for p in problems))
        known = [frozenset({"p1", "p2"})]
        self.assertFalse(any("duplicate" in p for p in checks.verify(self.folder, COUNTS, duplicates=known)))
        stale = checks.verify(self.folder, COUNTS, duplicates=known + [frozenset({"p3", "p9"})])
        self.assertTrue(any("known_duplicates" in p and "p9" in p for p in stale))

    def test_missing_notice(self):
        problems = self.problems(meta={"game": "1.0", "notice": {"en": "Notice.", "fr": ""}})
        self.assertEqual(len(problems), 1)
        self.assertIn("notice.fr", problems[0])
        problems = self.problems(meta={"notice": {"en": "a", "fr": "b"}})
        self.assertIn("game", problems[0])


if __name__ == "__main__":
    unittest.main()
