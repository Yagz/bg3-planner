import copy
import tempfile
import unittest
from pathlib import Path

from scripts.data import model

NULL = "00000000-0000-0000-0000-000000000000"


def node(node_id: str, children: list | None = None, **attributes) -> dict:
    return {"id": node_id, "attributes": attributes, "children": children or []}


def by_uuid(*nodes: dict) -> dict:
    return {n["attributes"]["UUID"]: n for n in nodes}


def dataset() -> tuple[dict, dict, dict]:
    """A small valid synthetic set: (lsx_by_file, presets, stats)."""
    classes = by_uuid(
        node("ClassDescription", Name="Fighter", UUID="c-fighter", ProgressionTableUUID="t-fighter",
             BaseHp="10", HpPerLevel="6", SpellCastingAbility="0", PrimaryAbility="1",
             DisplayName="hFighter", Description="hFighterDesc"),
        node("ClassDescription", Name="EldritchKnight", UUID="c-ek", ParentGuid="c-fighter",
             ProgressionTableUUID="t-ek", SpellCastingAbility="4", PrimaryAbility="1",
             SpellList="l-spells", MustPrepareSpells="false", MulticlassSpellcasterModifier="0.333",
             DisplayName="hEK;2", Description="hEKDesc;1"),
    )
    races = by_uuid(
        node("Race", Name="Elf", UUID="r-elf", ParentGuid=NULL, ProgressionTableUUID="t-elf",
             DisplayName="hElf", Description="hElfDesc"),
        node("Race", Name="Wraith", UUID="r-wraith", ProgressionTableUUID="t-wraith",
             DisplayName="hWraith", Description="hWraithDesc"),
    )
    backgrounds = by_uuid(
        node("Background", UUID="b-acolyte", Passives="Acolyte_Passive", Hidden="false",
             DisplayName="hAcolyte", Description="hAcolyteDesc"),
        node("Background", UUID="b-haunted", Passives="", Hidden="true",
             DisplayName="hHaunted", Description="hHauntedDesc"),
    )
    feats = by_uuid(
        node("Feat", Name="Alert", UUID="f-alert", PassivesAdded="Alert_Passive",
             Selectors="SelectSkills(l-skills,1)",
             Requirements="FeatRequirementAbilityGreaterEqual('Dexterity',13)",
             CanBeTakenMultipleTimes="false"),
    )
    feat_descriptions = by_uuid(
        node("FeatDescription", UUID="fd-alert", FeatId="f-alert", DisplayName="hAlert;1",
             Description="hAlertDesc;1"),
    )
    subclasses = node("SubClasses", [node("SubClass", Object="c-ek")])
    progressions = by_uuid(
        node("Progression", Name="Fighter", UUID="p-fighter-3", TableUUID="t-fighter", Level="3",
             ProgressionType="0", Boosts="ActionResource(SpellSlot,1,1);Proficiency(Shields)",
             PassivesAdded="Fighter_Passive", Selectors="", children=None),
        node("Progression", Name="Fighter", UUID="p-fighter-1", TableUUID="t-fighter", Level="1",
             ProgressionType="0", IsMulticlass="false", AllowImprovement="false",
             PassivesAdded="", Selectors="SelectSkills(l-skills,2)"),
        node("Progression", Name="EldritchKnight", UUID="p-ek-3", TableUUID="t-ek", Level="3",
             ProgressionType="1", Selectors="SelectSpells(l-spells,2,0);SelectPassives(l-passives,1)",
             PassivesRemoved="Old_Passive"),
        node("Progression", Name="Elf", UUID="p-elf-1", TableUUID="t-elf", Level="1",
             ProgressionType="2", AllowImprovement="true", PassivesAdded="Darkvision"),
        node("Progression", Name="Goblin", UUID="p-npc-1", TableUUID="t-npc", Level="1",
             ProgressionType="0", PassivesAdded="Npc_Passive_Missing_From_Stats"),
        node("Progression", Name="CLASSES", UUID="p-header"),
    )
    progressions["p-fighter-1"]["children"] = [subclasses]
    spell_lists = by_uuid(
        node("SpellList", UUID="l-spells", Name="EK spells", Spells="Target_FireBolt;Shout_Shield;"),
        node("SpellList", UUID="l-unused", Name="Unused", Spells="Target_NotInStats"),
    )
    passive_lists = by_uuid(
        node("PassiveList", UUID="l-passives", Name="Styles", Passives="Style_A,Style_B"),
    )
    skill_lists = by_uuid(
        node("SkillList", UUID="l-skills", Name="Fighter skills", Skills="Athletics , Acrobatics , History"),
    )
    lsx_by_file = {
        "Progressions": progressions,
        "SpellLists": spell_lists,
        "PassiveLists": passive_lists,
        "SkillLists": skill_lists,
        "AbilityLists": {},
        "EquipmentLists": {},
        "ClassDescriptions": classes,
        "Races": races,
        "Backgrounds": backgrounds,
        "Feats": feats,
        "FeatDescriptions": feat_descriptions,
    }
    presets = by_uuid(
        node("CharacterCreationPreset", UUID="pr-elf", RaceUUID="r-elf", SubRaceUUID=NULL),
    )
    stats = {
        "Target_FireBolt": {"type": "SpellData", "SpellType": "Target", "Level": "0",
                            "SpellSchool": "Evocation", "DisplayName": "hFireBolt;1",
                            "Description": "hFireBoltDesc;2"},
        "Shout_Shield": {"type": "SpellData", "DisplayName": "hShield;1"},
    }
    for p in ["Acolyte_Passive", "Alert_Passive", "Fighter_Passive", "Old_Passive", "Darkvision",
              "Style_A", "Style_B"]:
        stats[p] = {"type": "PassiveData", "DisplayName": f"h{p};1", "Description": f"h{p}Desc;1"}
    return lsx_by_file, presets, stats


def build(data=None, **kwargs):
    return model.build(*(data or dataset()), **kwargs)


def errors_of(data, **kwargs) -> list[str]:
    with unittest.TestCase().assertRaises(model.ModelError) as c:
        model.build(*data, **kwargs)
    return c.exception.errors


def write_text(text: str) -> Path:
    folder = tempfile.TemporaryDirectory()
    unittest.addModuleCleanup(folder.cleanup)
    path = Path(folder.name) / "list.txt"
    path.write_text(text, encoding="utf-8")
    return path


TYPO = "SelectPassives(l-passives,1))"


class TestModel(unittest.TestCase):
    def test_valid_dataset_builds(self):
        rules = build()
        self.assertEqual(set(rules), {"classes", "races", "backgrounds", "feats", "progressions",
                                      "lists", "spells", "passives"})

    def test_class_fields(self):
        ek = build()["classes"]["EldritchKnight"]
        self.assertEqual(ek, {
            "uuid": "c-ek", "parent": "Fighter", "table": "t-ek", "spellcasting_ability": "Intelligence",
            "primary_ability": "Strength", "base_hp": None, "hp_per_level": None, "spell_list": "l-spells",
            "prepares_spells": False, "multiclass_modifier": 0.333,
            "text": {"name": "hEK", "description": "hEKDesc"},
        })
        fighter = build()["classes"]["Fighter"]
        self.assertIsNone(fighter["parent"])
        self.assertIsNone(fighter["spellcasting_ability"])
        self.assertEqual((fighter["base_hp"], fighter["hp_per_level"]), (10, 6))

    def test_race_not_in_presets_is_excluded(self):
        races = build()["races"]
        self.assertEqual(races, {"Elf": {"uuid": "r-elf", "parent": None, "table": "t-elf",
                                         "text": {"name": "hElf", "description": "hElfDesc"}}})

    def test_duplicate_race_name_only_an_error_among_kept(self):
        data = dataset()
        data[0]["Races"]["r-wraith2"] = node("Race", Name="Wraith", UUID="r-wraith2")
        build(data)
        data[0]["Races"]["r-elf2"] = node("Race", Name="Elf", UUID="r-elf2")
        data[1]["pr-elf2"] = node("CharacterCreationPreset", UUID="pr-elf2", RaceUUID="r-elf2")
        self.assertTrue(any("Elf" in e for e in errors_of(data)))

    def test_base_race_parent_ignored(self):
        data = dataset()
        data[0]["Races"]["r-elf"]["attributes"]["ParentGuid"] = "r-generic-not-playable"
        self.assertIsNone(build(data)["races"]["Elf"]["parent"])

    def test_subrace_parent_must_be_kept(self):
        data = dataset()
        data[0]["Races"]["r-high"] = node("Race", Name="HighElf", UUID="r-high", ParentGuid="r-elf")
        data[1]["pr-high"] = node("CharacterCreationPreset", UUID="pr-high", RaceUUID="r-elf", SubRaceUUID="r-high")
        self.assertEqual(build(data)["races"]["HighElf"]["parent"], "Elf")
        data[0]["Races"]["r-high"]["attributes"]["ParentGuid"] = "r-wraith"
        self.assertTrue(any("HighElf" in e for e in errors_of(data)))
        data[0]["Races"]["r-high"]["attributes"]["ParentGuid"] = NULL
        self.assertTrue(any("HighElf" in e for e in errors_of(data)))

    def test_race_both_base_and_subrace_is_base(self):
        data = dataset()
        data[0]["Races"]["r-elf"]["attributes"]["ParentGuid"] = "r-generic-not-playable"
        data[1]["pr-x"] = node("CharacterCreationPreset", UUID="pr-x", RaceUUID="r-elf", SubRaceUUID="r-elf")
        self.assertIsNone(build(data)["races"]["Elf"]["parent"])

    def test_class_spell_list_kept(self):
        data = dataset()
        data[0]["ClassDescriptions"]["c-ek"]["attributes"]["SpellList"] = "l-class"
        data[0]["SpellLists"]["l-class"] = node("SpellList", UUID="l-class", Name="Class", Spells="Target_Prepared")
        data[2]["Target_Prepared"] = {"type": "SpellData", "SpellType": "Target", "Level": "1"}
        rules = build(data)
        self.assertEqual(rules["lists"]["l-class"], {"name": "Class", "type": "spells", "items": ["Target_Prepared"]})
        self.assertIn("Target_Prepared", rules["spells"])

    def test_class_spell_list_unknown_is_orphan(self):
        data = dataset()
        data[0]["ClassDescriptions"]["c-ek"]["attributes"]["SpellList"] = "l-skills"
        self.assertTrue(any("l-skills" in e and "EldritchKnight" in e for e in errors_of(data)))
        data[0]["ClassDescriptions"]["c-ek"]["attributes"]["SpellList"] = "l-ghost"
        self.assertTrue(any("l-ghost" in e for e in errors_of(data)))

    def test_select_spells_class_converted_to_name(self):
        data = dataset()
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectSpells(l-spells,1,0,,,,,,c-ek)"
        self.assertEqual(build(data)["feats"]["Alert"]["selectors"][0]["class"], "EldritchKnight")
        p = next(p for p in build()["progressions"] if p["uuid"] == "p-ek-3")
        self.assertIsNone(p["selectors"][0]["class"])
        self.assertNotIn("class", p["selectors"][1])
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectSpells(l-spells,1,0,,,,,,c-ghost)"
        self.assertTrue(any("c-ghost" in e for e in errors_of(data)))

    def test_preset_race_missing_is_orphan(self):
        data = dataset()
        data[1]["pr-x"] = node("CharacterCreationPreset", UUID="pr-x", RaceUUID="r-ghost")
        self.assertTrue(any("r-ghost" in e for e in errors_of(data)))

    def test_hidden_background_kept_as_origin(self):
        backgrounds = build()["backgrounds"]
        self.assertEqual(backgrounds["b-haunted"], {"passives": [], "origin": True,
                                                    "text": {"name": "hHaunted", "description": "hHauntedDesc"}})
        self.assertFalse(backgrounds["b-acolyte"]["origin"])
        self.assertEqual(backgrounds["b-acolyte"]["passives"], ["Acolyte_Passive"])

    def test_feat_fields(self):
        alert = build()["feats"]["Alert"]
        self.assertEqual(alert["uuid"], "f-alert")
        self.assertEqual(alert["passives"], ["Alert_Passive"])
        self.assertEqual(alert["selectors"][0]["function"], "SelectSkills")
        self.assertEqual(alert["requirements"], [{"type": "ability_min", "ability": "Dexterity", "value": 13}])
        self.assertFalse(alert["repeatable"])
        self.assertEqual(alert["text"], {"name": "hAlert", "description": "hAlertDesc"})

    def test_feat_without_description_is_orphan(self):
        data = dataset()
        data[0]["FeatDescriptions"] = {}
        self.assertTrue(any("Alert" in e for e in errors_of(data)))

    def test_subclass_resolved_to_name(self):
        p = next(p for p in build()["progressions"] if p["uuid"] == "p-fighter-1")
        self.assertEqual(p["subclasses"], ["EldritchKnight"])

    def test_unknown_subclass_is_orphan(self):
        data = dataset()
        data[0]["Progressions"]["p-fighter-1"]["children"][0]["children"][0]["attributes"]["Object"] = "c-ghost"
        self.assertTrue(any("c-ghost" in e for e in errors_of(data)))

    def test_progression_fields(self):
        p = next(p for p in build()["progressions"] if p["uuid"] == "p-fighter-3")
        self.assertEqual(p, {
            "uuid": "p-fighter-3", "table": "t-fighter", "name": "Fighter", "level": 3, "type": "class",
            "multiclass": False, "feat": False,
            "boosts": ["ActionResource(SpellSlot,1,1)", "Proficiency(Shields)"],
            "passives_added": ["Fighter_Passive"], "passives_removed": [], "selectors": [], "subclasses": [],
        })
        types = {p["uuid"]: p["type"] for p in build()["progressions"]}
        self.assertEqual((types["p-ek-3"], types["p-elf-1"]), ("subclass", "race"))

    def test_spell_kept_through_referenced_list(self):
        rules = build()
        self.assertEqual(rules["lists"]["l-spells"], {"name": "EK spells", "type": "spells",
                                                      "items": ["Target_FireBolt", "Shout_Shield"]})
        self.assertNotIn("l-unused", rules["lists"])
        self.assertEqual(rules["spells"]["Target_FireBolt"], {
            "type": "Target", "level": 0, "school": "Evocation",
            "text": {"name": "hFireBolt", "description": "hFireBoltDesc"}})
        self.assertEqual(rules["spells"]["Shout_Shield"], {
            "type": "SpellData", "level": None, "school": None, "text": {"name": "hShield", "description": None}})
        self.assertNotIn("Target_NotInStats", rules["spells"])

    def test_passive_list_split_on_comma(self):
        rules = build()
        self.assertEqual(rules["lists"]["l-passives"]["items"], ["Style_A", "Style_B"])
        self.assertEqual(rules["lists"]["l-passives"]["type"], "passives")
        self.assertIn("Style_B", rules["passives"])

    def test_skill_list_items_stripped(self):
        self.assertEqual(build()["lists"]["l-skills"]["items"], ["Athletics", "Acrobatics", "History"])

    def test_passives_kept(self):
        self.assertEqual(sorted(build()["passives"]), sorted([
            "Acolyte_Passive", "Alert_Passive", "Fighter_Passive", "Old_Passive", "Darkvision", "Style_A",
            "Style_B"]))
        self.assertEqual(build()["passives"]["Darkvision"], {"boosts": [], "text": {
            "name": "hDarkvision", "description": "hDarkvisionDesc"}})

    def test_passive_boosts(self):
        data = dataset()
        data[2]["Darkvision"]["Boosts"] = "DarkvisionRangeMin(12); ;\n  ActiveCharacterLight(abc);\nIF(x):Advantage(Skill, Stealth)  ;"
        self.assertEqual(build(data)["passives"]["Darkvision"]["boosts"],
                         ["DarkvisionRangeMin(12)", "ActiveCharacterLight(abc)", "IF(x):Advantage(Skill, Stealth)"])

    def test_npc_progression_dropped(self):
        uuids = {p["uuid"] for p in build()["progressions"]}
        self.assertNotIn("p-npc-1", uuids)
        self.assertNotIn("p-header", uuids)
        self.assertEqual(len(uuids), 4)

    def test_spell_missing_from_stats_is_orphan(self):
        data = dataset()
        del data[2]["Shout_Shield"]
        self.assertTrue(any("Shout_Shield" in e for e in errors_of(data)))

    def test_duplicate_class_name(self):
        data = dataset()
        data[0]["ClassDescriptions"]["c-dup"] = node("ClassDescription", Name="Fighter", UUID="c-dup",
                                                     ProgressionTableUUID="t-dup")
        self.assertTrue(any("Fighter" in e for e in errors_of(data)))

    def test_list_uuid_in_two_files_is_duplicate(self):
        data = dataset()
        data[0]["AbilityLists"]["l-skills"] = node("AbilityList", UUID="l-skills", Abilities="Strength")
        self.assertTrue(any("l-skills" in e for e in errors_of(data)))

    def test_unknown_list_reference_is_orphan(self):
        data = dataset()
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectSkills(l-ghost,1)"
        self.assertTrue(any("l-ghost" in e for e in errors_of(data)))

    def test_unknown_selector_is_reported(self):
        data = dataset()
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectMagic(l-skills,1)"
        self.assertTrue(any("SelectMagic" in e for e in errors_of(data)))

    def test_handle_version_stripped(self):
        self.assertEqual(model.handle("h1;3"), "h1")
        self.assertEqual(model.handle("h1"), "h1")
        self.assertIsNone(model.handle(""))
        self.assertIsNone(model.handle(None))
        self.assertEqual(build()["classes"]["EldritchKnight"]["text"]["name"], "hEK")

    def test_all_errors_reported_together(self):
        data = dataset()
        del data[2]["Shout_Shield"]
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectSkills(l-ghost,1)"
        errors = errors_of(data)
        self.assertTrue(any("Shout_Shield" in e for e in errors))
        self.assertTrue(any("l-ghost" in e for e in errors))

    def test_progressions_sorted(self):
        keys = [(p["table"], p["level"], p["multiclass"], p["uuid"]) for p in build()["progressions"]]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual([p["uuid"] for p in build()["progressions"]],
                         ["p-ek-3", "p-elf-1", "p-fighter-1", "p-fighter-3"])

    def test_listed_typo_corrected_on_exact_match(self):
        data = dataset()
        data[0]["Progressions"]["p-ek-3"]["attributes"]["Selectors"] = f"SelectSpells(l-spells,2,0); {TYPO}"
        rules = build(data, typos={TYPO: "SelectPassives(l-passives,1)"})
        p = next(p for p in rules["progressions"] if p["uuid"] == "p-ek-3")
        self.assertEqual(p["selectors"][1], {"function": "SelectPassives", "list": "l-passives", "count": 1,
                                             "id": None})

    def test_unlisted_typo_still_raises(self):
        data = dataset()
        data[0]["Progressions"]["p-ek-3"]["attributes"]["Selectors"] = TYPO
        self.assertTrue(any(TYPO in e for e in errors_of(data)))
        # A listed correction applies to the exact segment only.
        data[0]["Progressions"]["p-ek-3"]["attributes"]["Selectors"] = "SelectPassives(l-passives,2))"
        errors = errors_of(data, typos={TYPO: "SelectPassives(l-passives,1)"})
        self.assertTrue(any("SelectPassives(l-passives,2))" in e for e in errors))

    def test_stale_typo_raises(self):
        errors = errors_of(dataset(), typos={TYPO: "SelectPassives(l-passives,1)"})
        self.assertTrue(any("game_typos" in e and TYPO in e for e in errors))

    def test_typo_applies_to_feats(self):
        data = dataset()
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectSkills(l-skills,1))"
        rules = build(data, typos={"SelectSkills(l-skills,1))": "SelectSkills(l-skills,1)"})
        self.assertEqual(rules["feats"]["Alert"]["selectors"][0]["list"], "l-skills")

    def test_read_typos(self):
        path = write_text("# header\n\nA(x)) => A(x)  # Larian typo\n")
        self.assertEqual(model.read_typos(path), {"A(x))": "A(x)"})
        for bad in ("A(x)) A(x)  # no arrow\n", "A(x)) => A(x)\n", "A(x)) => A(x)  #  \n",
                    "A(x)) => A(x)  # r\nA(x)) => A(y)  # r\n"):
            with self.assertRaises(ValueError, msg=bad):
                model.read_typos(write_text(bad))

    def duplicated(self):
        data = dataset()
        data[0]["Progressions"]["p-fighter-3b"] = node(
            "Progression", Name="Fighter", UUID="p-fighter-3b", TableUUID="t-fighter", Level="3",
            ProgressionType="0")
        return data

    def test_duplicate_progression_is_an_error(self):
        errors = errors_of(self.duplicated())
        self.assertTrue(any("p-fighter-3" in e and "p-fighter-3b" in e for e in errors))
        # Same table and level but another multiclass flag: not a duplicate.
        data = self.duplicated()
        data[0]["Progressions"]["p-fighter-3b"]["attributes"]["IsMulticlass"] = "true"
        build(data)

    def test_known_duplicate_kept_unchanged(self):
        rules = build(self.duplicated(), duplicates=[frozenset({"p-fighter-3", "p-fighter-3b"})])
        self.assertEqual([p["uuid"] for p in rules["progressions"] if p["table"] == "t-fighter"],
                         ["p-fighter-1", "p-fighter-3", "p-fighter-3b"])

    def test_known_duplicate_must_match_the_whole_group(self):
        data = self.duplicated()
        data[0]["Progressions"]["p-fighter-3c"] = node(
            "Progression", Name="Fighter", UUID="p-fighter-3c", TableUUID="t-fighter", Level="3",
            ProgressionType="0")
        errors = errors_of(data, duplicates=[frozenset({"p-fighter-3", "p-fighter-3b"})])
        self.assertTrue(any("p-fighter-3c" in e for e in errors))

    def test_stale_known_duplicate_raises(self):
        errors = errors_of(dataset(), duplicates=[frozenset({"p-fighter-3", "p-ghost"})])
        self.assertTrue(any("known_duplicates" in e and "p-ghost" in e for e in errors))

    def test_read_duplicates(self):
        path = write_text("# header\n\nu1 u2  # the game has two nodes\n u3  u4 u5 # reason\n")
        self.assertEqual(model.read_duplicates(path), [frozenset({"u1", "u2"}), frozenset({"u3", "u4", "u5"})])
        for bad in ("u1 u2\n", "u1  # one UUID is not a group\n", "u1 u1  # repeated\n",
                    "u1 u2  # r\nu2 u3  # r\n"):
            with self.assertRaises(ValueError, msg=bad):
                model.read_duplicates(write_text(bad))

    def test_deterministic(self):
        self.assertEqual(build(), build())


if __name__ == "__main__":
    unittest.main()
