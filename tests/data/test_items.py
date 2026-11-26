import copy
import tempfile
import unittest
from pathlib import Path

from scripts.data import importer, items, model, texts
from tests.data.test_model import dataset, node


def item_data() -> dict:
    """Synthetic wiki items, item stats and resolved templates, consistent with each other."""
    wiki = {
        "MAG_Boots": {"uuid": "t-boots", "kind": "equipment", "rarity": "rare", "legacy": None, "locations": []},
        "WPN_Sword": {"uuid": None, "kind": "weapon", "rarity": "common", "legacy": None, "locations": []},
        "ARM_Boots_Fancy": {"uuid": "t-fancy", "kind": "equipment", "rarity": "common", "legacy": None,
                            "locations": []},
        "MAG_Old": {"uuid": "t-old", "kind": "equipment", "rarity": "rare", "legacy": "unobtainable",
                    "locations": []},
    }
    item_stats = {
        "MAG_Boots": {"type": "Armor", "Slot": "Boots", "Rarity": "Rare", "RootTemplate": "t-boots"},
        "WPN_Sword": {"type": "Weapon", "Slot": "Melee Main Weapon", "RootTemplate": "t-sword",
                      "Weapon Properties": "Versatile;Melee"},
        "ARM_Lute": {"type": "Armor", "Slot": "MusicalInstrument", "RootTemplate": "t-lute"},
        # Shared generic stats, whose own RootTemplate is another template.
        "ARM_Boots_Generic": {"type": "Armor", "Slot": "Boots", "RootTemplate": "t-generic"},
    }
    templates = {
        "t-boots": {"name": "MAG_Boots", "type": "item", "stats": "MAG_Boots", "display_name": "hBoots;1",
                    "description": "hBootsDesc;2", "parent": None},
        "t-sword": {"name": "WPN_Sword", "type": "item", "stats": "WPN_Sword", "display_name": "hSword",
                    "description": None, "parent": "t-boots"},
        "t-generic": {"name": "ARM_Boots_Generic", "type": "item", "stats": "ARM_Boots_Generic",
                      "display_name": "hGeneric", "description": "hGenericDesc", "parent": None},
        "t-fancy": {"name": "ARM_Boots_Fancy", "type": "item", "stats": "ARM_Boots_Generic",
                    "display_name": "hFancy", "description": "hFancyDesc", "parent": "t-generic"},
        "t-lute": {"name": "ARM_Lute", "type": "item", "stats": "ARM_Lute", "display_name": "hLute",
                   "description": None, "parent": None},
    }
    return {"wiki": wiki, "item_stats": item_stats, "templates": templates, "excluded": {}}


def build(data=None, **changes):
    kwargs = {**item_data(), **changes}
    return model.build(*(data or dataset()), **kwargs)


def errors_of(data=None, **changes) -> list[str]:
    with unittest.TestCase().assertRaises(model.ModelError) as c:
        build(data, **changes)
    return c.exception.errors


def write_text(text: str) -> Path:
    folder = tempfile.TemporaryDirectory()
    unittest.addModuleCleanup(folder.cleanup)
    path = Path(folder.name) / "list.txt"
    path.write_text(text, encoding="utf-8")
    return path


class ItemsTest(unittest.TestCase):
    def test_item_from_wiki_scope(self):
        rules = build()
        self.assertEqual(sorted(rules["items"]), ["ARM_Boots_Fancy", "MAG_Boots", "WPN_Sword"])
        self.assertEqual(rules["items"]["MAG_Boots"], {
            "kind": "equipment", "found_by": "stats", "stats_type": "Armor", "slot": "Boots", "rarity": "Rare",
            "root_template": "t-boots", "properties": [], "text": {"name": "hBoots", "description": "hBootsDesc"}})
        self.assertEqual(rules["items"]["WPN_Sword"], {
            "kind": "weapon", "found_by": "stats", "stats_type": "Weapon", "slot": "Melee Main Weapon", "rarity": None,
            "root_template": "t-sword", "properties": ["Versatile", "Melee"],
            "text": {"name": "hSword", "description": None}})

    def test_item_found_by_template(self):
        self.assertEqual(build()["items"]["ARM_Boots_Fancy"], {
            "kind": "equipment", "found_by": "template", "stats_type": "Armor", "slot": "Boots", "rarity": None,
            "root_template": "t-fancy", "properties": [], "text": {"name": "hFancy", "description": "hFancyDesc"}})

    def test_stats_name_takes_precedence_over_template(self):
        data = item_data()
        data["item_stats"]["ARM_Boots_Fancy"] = {"type": "Armor", "Slot": "Gloves", "RootTemplate": "t-fancy"}
        item = build(**data)["items"]["ARM_Boots_Fancy"]
        self.assertEqual((item["found_by"], item["slot"]), ("stats", "Gloves"))

    def test_template_path_errors(self):
        cases = [
            ("uuid", None, "is not a RootTemplate"),
            ("uuid", "t-ghost", "t-ghost"),
            ("uuid", "t-lute", "'ARM_Lute'"),
            ("stats", "OBJ_Locket", "OBJ_Locket"),
            ("display_name", None, "DisplayName"),
        ]
        for field, value, needle in cases:
            data = item_data()
            if field == "uuid":
                data["wiki"]["ARM_Boots_Fancy"]["uuid"] = value
            else:
                data["templates"]["t-fancy"][field] = value
            errors = errors_of(**data)
            self.assertEqual(len(errors), 1, (field, value, errors))
            self.assertIn("item ARM_Boots_Fancy", errors[0])
            self.assertIn(needle, errors[0])

    def test_legacy_item_out_of_scope(self):
        rules = build()
        self.assertNotIn("MAG_Old", rules["items"])
        # Out of scope, so its absence from the stats is not an error either.
        self.assertNotIn("MAG_Old", item_data()["item_stats"])
        # An item in the stats but not in the wiki is not imported.
        self.assertNotIn("ARM_Lute", rules["items"])

    def test_item_missing_from_stats_is_error(self):
        data = item_data()
        del data["item_stats"]["WPN_Sword"]
        errors = errors_of(**data)
        self.assertEqual(len(errors), 1)
        self.assertIn("item WPN_Sword", errors[0])
        self.assertIn("not found", errors[0])

    def test_stats_without_root_template_or_unknown_template_is_error(self):
        data = item_data()
        del data["item_stats"]["WPN_Sword"]["RootTemplate"]
        data["item_stats"]["MAG_Boots"]["RootTemplate"] = "t-ghost"
        data["wiki"]["MAG_Boots"]["uuid"] = "t-ghost"
        errors = errors_of(**data)
        self.assertEqual(len(errors), 2, errors)
        self.assertTrue(any("WPN_Sword" in e and "RootTemplate" in e for e in errors))
        self.assertTrue(any("MAG_Boots" in e and "t-ghost" in e for e in errors))

    def test_template_without_name_is_error(self):
        data = item_data()
        data["templates"]["t-sword"]["display_name"] = None
        errors = errors_of(**data)
        self.assertEqual(len(errors), 1)
        self.assertIn("item WPN_Sword", errors[0])
        self.assertIn("t-sword", errors[0])
        self.assertIn("DisplayName", errors[0])

    def test_uuid_mismatch_is_error(self):
        data = item_data()
        data["wiki"]["MAG_Boots"]["uuid"] = "t-other"
        errors = errors_of(**data)
        self.assertEqual(len(errors), 1)
        self.assertIn("item MAG_Boots", errors[0])
        self.assertIn("t-other", errors[0])
        self.assertIn("t-boots", errors[0])

    def test_excluded_item(self):
        data = item_data()
        del data["item_stats"]["WPN_Sword"]
        rules = build(**{**data, "excluded": {"WPN_Sword": "not in the game's item stats"}})
        self.assertEqual(sorted(rules["items"]), ["ARM_Boots_Fancy", "MAG_Boots"])

    def test_exclusion_no_longer_needed_is_error(self):
        errors = errors_of(excluded={"WPN_Sword": "was missing from the stats"})
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("items_excluded", errors[0])
        self.assertIn("WPN_Sword", errors[0])
        self.assertIn("remove it", errors[0])

    def test_kind_must_match_stats_type(self):
        for uid, kind in (("MAG_Boots", "weapon"), ("WPN_Sword", "equipment"), ("ARM_Boots_Fancy", "trinket")):
            data = item_data()
            data["wiki"][uid]["kind"] = kind
            errors = errors_of(**data)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn(f"item {uid}", errors[0])
            self.assertIn(repr(kind), errors[0])

    def test_stale_exclusion_is_error(self):
        errors = errors_of(excluded={"MAG_Old": "legacy anyway", "MAG_Ghost": "unknown"})
        self.assertEqual(len(errors), 2, errors)
        self.assertTrue(any("items_excluded" in e and "MAG_Old" in e for e in errors))
        self.assertTrue(any("items_excluded" in e and "MAG_Ghost" in e for e in errors))

    def test_equipment_list_item_must_exist(self):
        data = dataset()
        data[0]["EquipmentLists"]["l-equip"] = node("EquipmentList", UUID="l-equip", Name="Instruments",
                                                    Items="ARM_Lute;WPN_Missing")
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectEquipment(l-equip,1,)"
        errors = errors_of(data)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("WPN_Missing", errors[0])
        self.assertIn("l-equip", errors[0])
        data[0]["EquipmentLists"]["l-equip"]["attributes"]["Items"] = "ARM_Lute"
        self.assertEqual(build(data)["lists"]["l-equip"]["items"], ["ARM_Lute"])

    def test_item_errors_aggregated_with_rules_errors(self):
        data = dataset()
        del data[2]["Shout_Shield"]
        changes = item_data()
        del changes["item_stats"]["WPN_Sword"]
        errors = errors_of(data, **changes)
        self.assertTrue(any("Shout_Shield" in e for e in errors))
        self.assertTrue(any("WPN_Sword" in e for e in errors))

    def test_item_texts_resolved(self):
        rules = build()
        en = {"hBoots": "Boots", "hBootsDesc": "Fast.", "hSword": "Sword", "hFancy": "Fancy", "hFancyDesc": "F."}
        fr = {"hBoots": "Bottes", "hBootsDesc": "Rapides.", "hSword": "Épée", "hFancy": "Chic", "hFancyDesc": "C."}
        for section in ("classes", "races", "backgrounds", "feats", "spells", "passives"):
            rules[section] = {}
        out, texts_en, texts_fr = texts.resolve(rules, en, fr, set())
        self.assertEqual(texts_en["item:MAG_Boots"], {"name": "Boots", "description": "Fast."})
        self.assertEqual(texts_fr["item:WPN_Sword"], {"name": "Épée", "description": None})
        self.assertNotIn("text", out["items"]["MAG_Boots"])
        with self.assertRaises(texts.MissingText) as c:
            texts.resolve(rules, en, {k: v for k, v in fr.items() if k != "hBootsDesc"}, set())
        self.assertEqual(len(c.exception.errors), 1)
        self.assertIn("item:MAG_Boots", c.exception.errors[0])

    def test_without_items_arguments(self):
        rules = model.build(*dataset())
        self.assertEqual(rules["items"], {})

    def list_items(self, **changes):
        data = item_data()
        lists = {"l-equip": {"type": "equipment", "items": ["ARM_Lute", "MAG_Boots"]},
                 "l-spells": {"type": "spells", "items": ["ARM_Lute"]}}
        for key, value in changes.items():
            data[key] = value(data[key])
        present = {"MAG_Boots": {}}
        return items.list_items(lists, present, data["item_stats"], data["templates"], lambda h: h)

    def test_list_items_added_with_template_name(self):
        added, errors = self.list_items()
        self.assertEqual(errors, [])
        self.assertEqual(added, {"ARM_Lute": {
            "kind": "equipment", "found_by": "list", "stats_type": "Armor", "slot": "MusicalInstrument", "rarity": None,
            "root_template": "t-lute", "properties": [], "text": {"name": "hLute", "description": None}}})

    def test_list_items_in_the_rules(self):
        data = dataset()
        data[0]["EquipmentLists"]["l-equip"] = node("EquipmentList", UUID="l-equip", Name="Instruments",
                                                    Items="ARM_Lute;WPN_Sword")
        data[0]["Feats"]["f-alert"]["attributes"]["Selectors"] = "SelectEquipment(l-equip,1,)"
        rules = build(data)
        self.assertEqual(rules["items"]["ARM_Lute"]["found_by"], "list")
        # A wiki-scoped item keeps its wiki join.
        self.assertEqual(rules["items"]["WPN_Sword"]["found_by"], "stats")

    def test_list_weapon_kind(self):
        def sword_only(stats):
            stats["ARM_Lute"] = {"type": "Weapon", "Slot": "Melee Main Weapon", "RootTemplate": "t-lute",
                                 "Weapon Properties": "Finesse;Light;Thrown;Melee;Dippable"}
            return stats
        added, errors = self.list_items(item_stats=sword_only)
        self.assertEqual(errors, [])
        self.assertEqual((added["ARM_Lute"]["kind"], added["ARM_Lute"]["properties"]),
                         ("weapon", ["Finesse", "Light", "Thrown", "Melee", "Dippable"]))

    def test_list_item_already_present_skipped(self):
        added, errors = self.list_items()
        self.assertNotIn("MAG_Boots", added)
        self.assertEqual(errors, [])

    def test_list_item_errors(self):
        def no_root(stats):
            del stats["ARM_Lute"]["RootTemplate"]
            return stats

        def ghost_root(stats):
            stats["ARM_Lute"]["RootTemplate"] = "t-ghost"
            return stats

        def no_name(templates):
            templates["t-lute"]["display_name"] = None
            return templates
        for change, needle in (({"item_stats": no_root}, "RootTemplate"), ({"item_stats": ghost_root}, "t-ghost"),
                               ({"templates": no_name}, "DisplayName")):
            added, errors = self.list_items(**change)
            self.assertEqual(added, {}, needle)
            self.assertEqual(len(errors), 1, errors)
            self.assertIn("item ARM_Lute", errors[0])
            self.assertIn(needle, errors[0])

    def test_weapon_properties(self):
        data = item_data()
        data["item_stats"]["WPN_Sword"]["Weapon Properties"] = " Finesse;Light;;Thrown ;Melee;Dippable;"
        self.assertEqual(build(**data)["items"]["WPN_Sword"]["properties"],
                         ["Finesse", "Light", "Thrown", "Melee", "Dippable"])
        self.assertEqual(build(**data)["items"]["MAG_Boots"]["properties"], [])
        for value in ("", " ; ", None):
            data["item_stats"]["WPN_Sword"]["Weapon Properties"] = value
            errors = errors_of(**data)
            self.assertEqual(errors, ["item WPN_Sword: weapon without Weapon Properties"])

    def test_scope(self):
        wiki = item_data()["wiki"]
        self.assertEqual(items.scope(wiki, {}), ["ARM_Boots_Fancy", "MAG_Boots", "WPN_Sword"])
        self.assertEqual(items.scope(wiki, {"WPN_Sword": "r"}), ["ARM_Boots_Fancy", "MAG_Boots"])

    def test_read_excluded(self):
        path = write_text("# header\n\nWPN_Sword  # not a key item\n MAG_Boots # reason\n")
        self.assertEqual(model.read_excluded(path), {"WPN_Sword": "not a key item", "MAG_Boots": "reason"})
        for bad in ("WPN_Sword\n", "WPN_Sword  #  \n", "WPN_Sword  # r\nWPN_Sword  # r\n", "A B  # two ids\n"):
            with self.assertRaises(ValueError, msg=bad):
                model.read_excluded(write_text(bad))

    def test_read_wiki(self):
        path = write_text('{"source": "s", "license": "l", "items": {"A": {"uuid": null, "kind": "weapon", '
                          '"rarity": null, "legacy": null, "locations": []}}}')
        self.assertEqual(list(items.read_wiki(path)), ["A"])
        with self.assertRaises(ValueError):
            items.read_wiki(write_text('{"source": "s"}'))

    def test_committed_exclusion_file_is_readable(self):
        self.assertIsInstance(model.read_excluded(importer.ITEMS_EXCLUDED), dict)

    def test_input_untouched(self):
        data = item_data()
        before = copy.deepcopy(data)
        build(**data)
        self.assertEqual(data, before)


if __name__ == "__main__":
    unittest.main()
