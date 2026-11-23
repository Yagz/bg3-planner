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
         "selectors": [{"function": "SelectSpells", "list": "l-spells", "prepare": "AlwaysPrepared",
                        "cooldown": None, "class": "Wizard"}]},
        {"table": "t-evo", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
        {"table": "t-elf", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
        {"table": "t-high", "subclasses": [], "passives_added": [], "passives_removed": [], "selectors": []},
    ],
    "lists": {"l-spells": {"type": "spells", "items": ["Fireball"]},
              "l-pass": {"type": "passives", "items": ["Soldier"]}},
    "spells": {"Fireball": {}},
    "passives": {"Soldier": {}},
    "items": {"MAG_Boots": {"kind": "equipment", "found_by": "stats", "stats_type": "Armor", "slot": "Boots", "rarity": "Rare",
                            "root_template": "t-boots"}},
}
KEYS = ["class:Wizard", "class:Evocation", "race:Elf", "race:HighElf", "background:bg-1", "feat:Alert",
        "spell:Fireball", "passive:Soldier", "item:MAG_Boots"]
WIKI = {"MAG_Boots": {"uuid": "t-boots", "kind": "equipment", "rarity": "rare", "legacy": None, "locations": []},
        "MAG_Gone": {"uuid": None, "kind": "equipment", "rarity": "rare", "legacy": "unobtainable",
                     "locations": []}}


def verify(folder: Path, counts=COUNTS, **kwargs):
    """checks.verify on synthetic wiki items, no exclusion and no known duplicate, unless given."""
    return checks.verify(folder, counts, **{"wiki": WIKI, "excluded": {}, "duplicates": [], **kwargs})
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
        return verify(self.folder, COUNTS, duplicates=[])

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
        problems = verify(self.folder, COUNTS, duplicates=[])
        self.assertEqual(len(problems), 1)
        self.assertIn("spell:Fireball", problems[0])

    def test_stray_text_key(self):
        problems = self.problems(keys=KEYS + ["spell:Nope"])
        self.assertTrue(any("spell:Nope" in p for p in problems))

    def test_orphan_list(self):
        rules = copy.deepcopy(RULES)
        rules["progressions"][0]["selectors"] = [{"function": "AddSpells", "list": "l-missing"}]
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
        self.assertEqual(verify(self.folder, COUNTS, unnamed={"passive:Soldier"}, duplicates=[]), [])

    def test_wrong_count(self):
        write(self.folder)
        problems = verify(self.folder, {**COUNTS, "feats": 41}, duplicates=[])
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
        problems = verify(self.folder, COUNTS, duplicates=[])
        self.assertTrue(any("p1" in p and "p2" in p for p in problems), problems)
        self.assertFalse(any("p5" in p for p in problems))
        known = [frozenset({"p1", "p2"})]
        self.assertFalse(any("duplicate" in p for p in verify(self.folder, COUNTS, duplicates=known)))
        stale = verify(self.folder, COUNTS, duplicates=known + [frozenset({"p3", "p9"})])
        self.assertTrue(any("known_duplicates" in p and "p9" in p for p in stale))

    def test_new_counts(self):
        write(self.folder)
        counts = {"progressions": 4, "lists": 2, "spells": 1, "passives": 1}
        self.assertEqual(verify(self.folder, counts, duplicates=[]), [])
        problems = verify(self.folder, {"progressions": 663, "lists": 342, "spells": 416, "passives": 475},
                                 duplicates=[])
        self.assertEqual(len(problems), 4)
        self.assertEqual(checks.COUNTS["progressions"], 663)

    def test_selector_list_type(self):
        rules = copy.deepcopy(RULES)
        rules["feats"]["Alert"]["selectors"] = [{"function": "SelectPassives", "list": "l-spells"}]
        rules["progressions"][0]["selectors"].append({"function": "SelectMagic", "list": "l-pass"})
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("feat:Alert" in p and "SelectPassives" in p and "spells" in p for p in problems))
        self.assertTrue(any("SelectMagic" in p for p in problems))

    def test_every_function_pairing(self):
        pairs = {"AddSpells": "spells", "SelectSpells": "spells", "SelectPassives": "passives",
                 "ReplacePassives": "passives", "SelectSkills": "skills", "SelectSkillsExpertise": "skills",
                 "SelectAbilities": "abilities", "SelectAbilityBonus": "abilities", "SelectEquipment": "equipment"}
        self.assertEqual(checks.SELECTOR_LIST_TYPES, pairs)

    def test_select_spells_class_must_be_known(self):
        rules = copy.deepcopy(RULES)
        rules["progressions"][0]["selectors"][0]["class"] = "Necromancer"
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 1)
        self.assertIn("Necromancer", problems[0])
        rules["progressions"][0]["selectors"][0]["class"] = None
        self.assertEqual(self.problems(rules=rules), [])

    def test_prepare_and_cooldown_values(self):
        rules = copy.deepcopy(RULES)
        rules["progressions"][0]["selectors"][0].update(prepare="AlwaysPrepared)", cooldown="UntilLongRest")
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("AlwaysPrepared)" in p for p in problems))
        self.assertTrue(any("UntilLongRest" in p for p in problems))
        self.assertEqual(checks.PREPARE_VALUES, {None, "AlwaysPrepared"})
        self.assertEqual(checks.COOLDOWN_VALUES, {None, "UntilRest"})

    def test_item_needs_texts_in_both_languages(self):
        problems = self.problems(fr_keys=[k for k in KEYS if k != "item:MAG_Boots"])
        self.assertEqual(len(problems), 1)
        self.assertIn("item:MAG_Boots", problems[0])
        self.assertIn("French", problems[0])

    def test_every_obtainable_wiki_item_is_an_item(self):
        write(self.folder)
        wiki = {**WIKI, "WPN_Sword": {**WIKI["MAG_Boots"], "uuid": None}}
        problems = verify(self.folder, wiki=wiki)
        self.assertEqual(len(problems), 1)
        self.assertIn("WPN_Sword", problems[0])
        self.assertEqual(verify(self.folder, wiki=wiki, excluded={"WPN_Sword": "reason"}), [])

    def test_item_outside_the_scope(self):
        write(self.folder)
        problems = verify(self.folder, wiki={"MAG_Gone": WIKI["MAG_Gone"]})
        self.assertEqual(len(problems), 1)
        self.assertIn("MAG_Boots", problems[0])
        problems = verify(self.folder, excluded={"MAG_Boots": "reason"})
        self.assertEqual(len(problems), 1)
        self.assertIn("MAG_Boots", problems[0])

    def test_items_count(self):
        write(self.folder)
        self.assertEqual(verify(self.folder, {"items": 1}), [])
        problems = verify(self.folder, {"items": 2})
        self.assertEqual(len(problems), 1)
        self.assertIn("items", problems[0])
        self.assertEqual(checks.COUNTS["items"], 1167)

    def test_missing_notice(self):
        problems = self.problems(meta={"game": "1.0", "notice": {"en": "Notice.", "fr": ""}})
        self.assertEqual(len(problems), 1)
        self.assertIn("notice.fr", problems[0])
        problems = self.problems(meta={"notice": {"en": "a", "fr": "b"}})
        self.assertIn("game", problems[0])


if __name__ == "__main__":
    unittest.main()
