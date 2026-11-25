import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.data import checks, ui_names

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
              "l-pass": {"type": "passives", "items": ["Soldier"]},
              "l-skills": {"type": "skills", "items": ["Athletics", "Stealth"]}},
    "spells": {"Fireball": {}},
    "passives": {"Soldier": {}},
    "items": {"MAG_Boots": {"kind": "equipment", "found_by": "stats", "stats_type": "Armor", "slot": "Boots", "rarity": "Rare",
                            "root_template": "t-boots"}},
    "origins": {"Sh": {"class": "Wizard", "subclass": "Evocation", "race": "Elf", "subrace": "HighElf",
                       "background": "bg-1", "lockRace": True, "playable": True,
                       "abilities": {"Strength": 8, "Dexterity": 14, "Constitution": 14, "Intelligence": 15,
                                     "Wisdom": 12, "Charisma": 10}},
                "Generic": {"class": None, "subclass": None, "race": None, "subrace": None, "background": None,
                            "lockRace": False, "playable": True, "abilities": None}},
    "rulesets": {"EASY": {"order": 0, "values": {"MULTICLASSING": False, "PROFICIENCY_BONUS": 2}},
                 "HONOUR": {"order": 1, "values": {"HONOUR_STATS": True}}},
    "rulesetModifiers": {"MULTICLASSING": {"type": "bool", "default": True, "custom": True},
                         "PROFICIENCY_BONUS": {"type": "int", "default": 0, "min": -1, "max": 4, "custom": True},
                         "HONOUR_STATS": {"type": "bool", "default": False, "custom": False}},
}
ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]
SKILLS = {"Athletics": "Strength", "Stealth": "Dexterity"}
KEYS = (["class:Wizard", "class:Evocation", "race:Elf", "race:HighElf", "background:bg-1", "feat:Alert",
         "spell:Fireball", "passive:Soldier", "item:MAG_Boots", "origin:Sh", "origin:Generic", "ruleset:EASY",
         "ruleset:HONOUR", "modifier:MULTICLASSING", "modifier:PROFICIENCY_BONUS", "label:customMode"]
        + [f"skill:{s}" for s in ui_names.SKILLS] + [f"ability:{a}" for a in ABILITIES])
WIKI = {"MAG_Boots": {"uuid": "t-boots", "kind": "equipment", "rarity": "rare", "legacy": None, "locations": []},
        "MAG_Gone": {"uuid": None, "kind": "equipment", "rarity": "rare", "legacy": "unobtainable",
                     "locations": []}}


def verify(folder: Path, counts=COUNTS, **kwargs):
    """checks.verify on synthetic wiki items, no exclusion and no known duplicate, unless given."""
    return checks.verify(folder, counts, **{"wiki": WIKI, "excluded": {}, "duplicates": [], "descriptionless": set(),
                                            "unlocked": {}, "skills": SKILLS,
                                            "technical": {}, **kwargs})
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

    def test_description_only_entry(self):
        write(self.folder)
        self.assertEqual(verify(self.folder, descriptionless={"passive:Soldier"}), [])
        path = self.folder / "texts.fr.json"
        table = json.loads(path.read_text(encoding="utf-8"))
        table["passive:Soldier"]["description"] = "Present."
        path.write_text(json.dumps(table), encoding="utf-8")
        problems = verify(self.folder, descriptionless={"passive:Soldier"})
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("passive:Soldier", problems[0])
        self.assertIn("French", problems[0])
        # The name is still required.
        write(self.folder, keys=[k for k in KEYS if k != "passive:Soldier"])
        problems = verify(self.folder, descriptionless={"passive:Soldier"})
        self.assertTrue(any("passive:Soldier" in p and "no entry" in p for p in problems), problems)
        # A listed element that does not exist.
        write(self.folder)
        problems = verify(self.folder, descriptionless={"passive:Ghost"})
        self.assertEqual(len(problems), 1)
        self.assertIn("passive:Ghost", problems[0])

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
        counts = {"progressions": 4, "lists": 3, "spells": 1, "passives": 1}
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

    def test_exclusion_must_be_an_obtainable_wiki_item(self):
        write(self.folder)
        for uid in ("MAG_Gone", "MAG_Unknown"):
            problems = verify(self.folder, excluded={uid: "reason"})
            self.assertEqual(len(problems), 1, problems)
            self.assertIn(f"items_excluded.txt: {uid} is not an obtainable wiki item", problems[0])

    def with_item(self, **changes):
        rules = copy.deepcopy(RULES)
        rules["items"]["MAG_Boots"].update(changes)
        write(self.folder, rules=rules)
        return verify(self.folder)

    def test_item_join_is_reverified(self):
        write(self.folder)
        self.assertEqual(verify(self.folder), [])
        problems = self.with_item(root_template="t-other")
        self.assertEqual(len(problems), 1)
        self.assertIn("root_template", problems[0])
        problems = self.with_item(found_by="guess")
        self.assertEqual(len(problems), 1)
        self.assertIn("found_by", problems[0])
        for found_by in ("stats", "template"):
            self.assertEqual(self.with_item(found_by=found_by), [])

    def test_item_kind_must_match_stats_type(self):
        problems = self.with_item(stats_type="Weapon")
        self.assertEqual(len(problems), 1)
        self.assertIn("does not match the stats type", problems[0])
        problems = self.with_item(kind="weapon", stats_type="Weapon")
        self.assertEqual(len(problems), 1)
        self.assertIn("wiki kind", problems[0])

    def test_items_count(self):
        write(self.folder)
        self.assertEqual(verify(self.folder, {"items": 1}), [])
        problems = verify(self.folder, {"items": 2})
        self.assertEqual(len(problems), 1)
        self.assertIn("items", problems[0])
        self.assertEqual(checks.COUNTS["items"], 1167)

    def test_origins_count(self):
        write(self.folder)
        self.assertEqual(verify(self.folder, {"origins": 2}), [])
        problems = verify(self.folder, {"origins": 3})
        self.assertEqual(len(problems), 1)
        self.assertIn("origins", problems[0])
        self.assertEqual(checks.COUNTS["origins"], 25)

    def test_rulesets_count(self):
        write(self.folder)
        self.assertEqual(verify(self.folder, {"rulesets": 2}), [])
        problems = verify(self.folder, {"rulesets": 5})
        self.assertEqual(len(problems), 1)
        self.assertIn("rulesets", problems[0])
        self.assertEqual(checks.COUNTS["rulesets"], 5)

    def test_ruleset_values_are_checked_against_the_modifiers(self):
        rules = copy.deepcopy(RULES)
        rules["rulesets"]["EASY"]["values"] = {"MULTICLASSING": 1, "PROFICIENCY_BONUS": 9, "NOPE": True}
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 3, problems)
        for needle in ("MULTICLASSING: 1 is not a bool", "PROFICIENCY_BONUS: 9 is outside -1..4", "NOPE: not a known"):
            self.assertTrue(any(needle in p for p in problems), (needle, problems))

    def test_ruleset_orders_must_be_contiguous(self):
        rules = copy.deepcopy(RULES)
        rules["rulesets"]["HONOUR"]["order"] = 0
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("order", problems[0])

    def test_missing_build_modifier(self):
        rules = copy.deepcopy(RULES)
        del rules["rulesetModifiers"]["HONOUR_STATS"]
        rules["rulesets"]["HONOUR"]["values"] = {}
        problems = self.problems(rules=rules)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("HONOUR_STATS missing", problems[0])

    def test_custom_modifier_needs_a_name(self):
        problems = self.problems(keys=[k for k in KEYS if k != "modifier:MULTICLASSING"])
        self.assertTrue(any("modifier:MULTICLASSING: no entry" in p for p in problems), problems)

    def test_missing_notice(self):
        problems = self.problems(meta={"game": "1.0", "notice": {"en": "Notice.", "fr": ""}})
        self.assertEqual(len(problems), 1)
        self.assertIn("notice.fr", problems[0])
        problems = self.problems(meta={"notice": {"en": "a", "fr": "b"}})
        self.assertIn("game", problems[0])

    def test_unlocked_subclass(self):
        rules = copy.deepcopy(RULES)
        rules["classes"]["Necromancy"] = {"parent": "Wizard", "table": "t-necro", "spell_list": None}
        rules["progressions"].append({"table": "t-necro", "subclasses": [], "passives_added": [], "passives_removed": [],
                                      "selectors": []})
        write(self.folder, rules=rules, keys=KEYS + ["class:Necromancy"])
        counts = {**COUNTS, "subclasses": 2}
        entry = {"parent": "Wizard", "reason": "Unlocked in play.", "source": "bg3.wiki: Wizard"}
        self.assertEqual(verify(self.folder, counts, unlocked={"Necromancy": entry}), [])
        cases = {
            "Ghost": ({"Ghost": entry}, "not a class"),
            "wrong parent": ({"Necromancy": {**entry, "parent": "Cleric"}}, "parent"),
            "empty reason": ({"Necromancy": {**entry, "reason": " "}}, "reason"),
            "empty source": ({"Necromancy": {**entry, "source": ""}}, "source"),
            "offered": ({"Evocation": entry}, "offered"),
        }
        for name, (unlocked, word) in cases.items():
            with self.subTest(name):
                problems = verify(self.folder, counts, unlocked=unlocked)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("unlocked_subclasses", problems[0])
                self.assertIn(word, problems[0])

    def test_origin_references(self):
        rules = copy.deepcopy(RULES)
        rules["origins"]["Sh"].update({"class": "Bard", "subclass": "Lore", "race": "Orc", "subrace": "HalfOrc",
                                       "background": "bg-9"})
        rules["origins"]["Generic"]["abilities"] = {"Strength": 8}
        problems = self.problems(rules=rules)
        for needle in ("origin:Sh: unknown class Bard", "unknown subclass Lore", "unknown race Orc",
                       "unknown subrace HalfOrc", "unknown background bg-9", "origin:Generic: abilities"):
            self.assertTrue(any(needle in p for p in problems), (needle, problems))

    def test_origin_playable_flag_is_a_boolean(self):
        rules = copy.deepcopy(RULES)
        rules["origins"]["Sh"]["playable"] = "yes"
        del rules["origins"]["Generic"]["playable"]
        problems = self.problems(rules=rules)
        for needle in ("origin:Sh: playable must be true or false", "origin:Generic: playable must be true or false"):
            self.assertTrue(any(needle in p for p in problems), (needle, problems))

    def test_origin_needs_texts(self):
        problems = self.problems(keys=[k for k in KEYS if k != "origin:Sh"])
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(all("origin:Sh" in p for p in problems))

    def test_skill_and_ability_need_texts(self):
        problems = self.problems(fr_keys=[k for k in KEYS if k not in ("skill:Stealth", "ability:Wisdom")])
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("skill:Stealth" in p and "French" in p for p in problems))
        self.assertTrue(any("ability:Wisdom" in p and "French" in p for p in problems))

    def test_skills_map_matches_the_skill_lists(self):
        write(self.folder)
        cases = {"missing": ({"Athletics": "Strength"}, "Stealth"),
                 "extra": ({**SKILLS, "Juggling": "Dexterity"}, "Juggling"),
                 "not an ability": ({**SKILLS, "Stealth": "Luck"}, "Luck")}
        for name, (skills, word) in cases.items():
            with self.subTest(name):
                problems = verify(self.folder, skills=skills)
                self.assertEqual(len(problems), 1, problems)
                self.assertIn("skills.json", problems[0])
                self.assertIn(word, problems[0])

    def test_technical_flags_match_the_list(self):
        rules = copy.deepcopy(RULES)
        rules["passives"]["Soldier"]["technical"] = True
        write(self.folder, rules=rules)
        self.assertEqual(verify(self.folder, technical={"Soldier": "toggle"}), [])
        problems = verify(self.folder)
        self.assertEqual(len(problems), 1, problems)
        self.assertIn("passive:Soldier", problems[0])
        write(self.folder)
        problems = verify(self.folder, technical={"Soldier": "toggle", "Ghost": "gone"})
        self.assertEqual(len(problems), 2, problems)
        self.assertTrue(any("Ghost" in p and "technical_passives" in p for p in problems))

    def test_technical_candidates(self):
        rules = copy.deepcopy(RULES)
        rules["passives"].update({"Slot_1": {}, "Toggle_A": {}, "Toggle_B": {}, "Listed": {}, "Named": {}})
        en = {"passive:Soldier": {"name": "Soldier"}, "passive:Slot_1": {"name": "First level slots"},
              "passive:Named": {"name": "Named"}, "passive:Listed": {"name": ""}}
        fr = {"passive:Soldier": {"name": "Soldat"}, "passive:Slot_1": {"name": "des emplacements"},
              "passive:Named": {"name": "Nommé"}}
        lines = checks.technical_candidates(rules, {"texts.en": en, "texts.fr": fr}, {"Listed": "reason"})
        text = "\n".join(lines)
        self.assertNotIn("Soldier", text)
        self.assertNotIn("Named", text)
        self.assertNotIn("Listed", text)
        self.assertIn("Slot_1", text)
        self.assertLess(text.index("Toggle_A"), text.index("Toggle_B"))
        self.assertEqual(len([line for line in lines if line.startswith("  ")]), 3)

    def test_technical_candidates_command(self):
        write(self.folder)
        with mock.patch("sys.stdout", new_callable=io.StringIO) as stdout, \
                mock.patch.object(checks, "TECHNICAL_PASSIVES", self.folder / "none.txt"):
            (self.folder / "none.txt").write_text("", encoding="utf-8")
            code = checks.main(["checks", str(self.folder), "--technical-candidates"])
        self.assertEqual(code, 0)
        self.assertIn("0 candidate", stdout.getvalue())
        with mock.patch("sys.stderr"):
            self.assertEqual(checks.main(["checks", str(self.folder), "--other"]), 2)

    def test_committed_skills_map(self):
        skills = checks.read_skills(checks.SKILLS)
        rules = json.loads((Path(checks.__file__).parents[2] / "data" / "larian" / "rules.json").read_text(encoding="utf-8"))
        self.assertEqual(checks.check_skills(rules, skills), [])
        self.assertEqual(len(skills), 18)
        self.assertEqual(skills["Athletics"], "Strength")
        self.assertEqual(sorted(k for k, v in skills.items() if v == "Wisdom"),
                         ["AnimalHandling", "Insight", "Medicine", "Perception", "Survival"])

    def test_committed_unlocked_subclasses(self):
        unlocked = checks.read_unlocked(checks.UNLOCKED_SUBCLASSES)
        self.assertEqual(unlocked["Oathbreaker"]["parent"], "Paladin")
        rules = json.loads((Path(checks.__file__).parents[2] / "data" / "larian" / "rules.json").read_text(encoding="utf-8"))
        self.assertEqual(checks.check_unlocked(rules, unlocked), [])


if __name__ == "__main__":
    unittest.main()
