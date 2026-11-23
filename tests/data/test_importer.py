import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from xml.sax.saxutils import quoteattr

from scripts.data import importer
from tests.data import fixtures


def lsx(node_type: str, *nodes: dict) -> bytes:
    """Minimal LSX file: a region holding a "root" node whose children are the given nodes."""
    body = []
    for attributes in nodes:
        attrs = "".join(
            f'<attribute id="{k}" type="TranslatedString" handle={quoteattr(v)} version="1"/>'
            if k in ("DisplayName", "Description") else f'<attribute id="{k}" type="guid" value={quoteattr(v)}/>'
            for k, v in attributes.items())
        body.append(f'<node id="{node_type}">{attrs}</node>')
    xml = (f'<?xml version="1.0" encoding="utf-8"?><save><region id="{node_type}s"><node id="root"><children>'
           f'{"".join(body)}</children></node></region></save>')
    return xml.encode("utf-8")


def templates_lsf(*templates: dict) -> bytes:
    """RootTemplates `_merged.lsf`: one GameObjects node per template, string attributes."""
    kinds = {"MapKey": "FixedString", "DisplayName": "TranslatedString", "Description": "TranslatedString"}
    nodes = [{"id": "GameObjects", "children": [],
              "attributes": {k: (kinds.get(k, "FixedString"), v) for k, v in t.items()}} for t in templates]
    return fixtures.lsf({"Templates": nodes})


def rules_files() -> dict[str, dict[str, bytes]]:
    """A small consistent set of rules files, split over the three rules paks."""
    shared = {
        "Public/Shared/ClassDescriptions/ClassDescriptions.lsx": lsx(
            "ClassDescription",
            {"UUID": "c-fighter", "Name": "Fighter", "ProgressionTableUUID": "t-fighter", "BaseHp": "10",
             "HpPerLevel": "6", "SpellCastingAbility": "0", "PrimaryAbility": "1",
             "DisplayName": "hFighter", "Description": "hFighterDesc"}),
        "Public/Shared/Progressions/Progressions.lsx": lsx(
            "Progression",
            {"UUID": "p-fighter-1", "Name": "Fighter", "TableUUID": "t-fighter", "Level": "1",
             "ProgressionType": "0", "PassivesAdded": "Fighter_Passive",
             "Selectors": "SelectSkills(l-skills,2);AddSpells(l-spells)"}),
        "Public/Shared/Lists/SkillLists.lsx": lsx(
            "SkillList", {"UUID": "l-skills", "Name": "Fighter skills", "Skills": "Athletics,History"}),
        # Longer name that the SkillLists pattern must not pick up.
        "Public/Shared/Lists/SkillListsOld.lsx": b"not xml",
        "Public/Shared/Lists/SpellLists.lsx": lsx(
            "SpellList", {"UUID": "l-spells", "Name": "Spells", "Spells": "Target_FireBolt"}),
        "Public/Shared/Races/Races.lsx": lsx(
            "Race", {"UUID": "r-elf", "Name": "Elf", "ProgressionTableUUID": "t-elf",
                     "DisplayName": "hElf", "Description": "hElfDesc"}),
        "Public/Shared/Stats/Generated/Data/Passive.txt": (
            'new entry "Fighter_Passive"\ntype "PassiveData"\ndata "DisplayName" "hFighterPassive;1"\n\n'
            'new entry "Alert_Passive"\ntype "PassiveData"\ndata "DisplayName" "hAlertPassive;1"\n').encode(),
        "Public/Shared/Stats/Generated/Data/Spell_Target.txt": (
            'new entry "Target_FireBolt"\ntype "SpellData"\ndata "SpellType" "Target"\ndata "Level" "0"\n'
            'data "DisplayName" "hFireBolt;1"\n').encode(),
        "Public/Shared/Stats/Generated/Data/Armor.txt": (
            'new entry "MAG_Boots"\ntype "Armor"\ndata "RootTemplate" "t-boots"\ndata "Slot" "Boots"\n'
            'data "Rarity" "Rare"\n').encode(),
        # Another stats format, not read.
        "Public/Shared/Stats/Generated/Data/Object.txt": b"garbage that is not stats",
        "Public/Shared/RootTemplates/_merged.lsf": templates_lsf(
            {"MapKey": "t-boots", "Name": "MAG_Boots", "Stats": "MAG_Boots", "DisplayName": "hBoots",
             "Description": "hBootsDesc"},
            {"MapKey": "t-base", "Name": "BASE_Weapon", "DisplayName": "hBase"}),
    }
    gustav = {
        "Public/Gustav/Backgrounds/Backgrounds.lsx": lsx(
            "Background", {"UUID": "b-acolyte", "Passives": "", "Hidden": "false",
                           "DisplayName": "hAcolyte", "Description": "hAcolyteDesc"}),
        "Public/Gustav/Feats/Feats.lsx": lsx(
            "Feat", {"UUID": "f-alert", "Name": "Alert", "PassivesAdded": "Alert_Passive"}),
        "Public/Gustav/Feats/FeatDescriptions.lsx": lsx(
            "FeatDescription", {"UUID": "fd-alert", "FeatId": "f-alert", "DisplayName": "hAlert",
                                "Description": "hAlertDesc"}),
        "Public/Gustav/CharacterCreationPresets/CharacterCreationPresets.lsx": lsx(
            "CharacterCreationPreset", {"UUID": "pr-elf", "RaceUUID": "r-elf"}),
        # Gustav overrides the Shared Fire Bolt: one layer per module, the later one wins.
        "Public/Gustav/Stats/Generated/Data/Spell_Target.txt": (
            'new entry "Target_FireBolt"\ntype "SpellData"\ndata "SpellType" "Target"\ndata "Level" "0"\n'
            'data "SpellSchool" "Evocation"\ndata "DisplayName" "hFireBolt2;1"\n').encode(),
        "Public/Gustav/Stats/Generated/Data/Weapon.txt": (
            'new entry "WPN_Sword"\ntype "Weapon"\ndata "RootTemplate" "t-sword"\n'
            'data "Slot" "Melee Main Weapon"\n').encode(),
        # Gustav's template inherits its name from Shared's base template.
        "Public/Gustav/RootTemplates/_merged.lsf": templates_lsf(
            {"MapKey": "t-sword", "Name": "WPN_Sword", "Stats": "WPN_Sword", "ParentTemplateId": "t-base"},
            # Found by its template name: its stats are WPN_Sword's.
            {"MapKey": "t-fancy", "Name": "WPN_Sword_Fancy", "Stats": "WPN_Sword", "DisplayName": "hFancy"}),
    }
    gustavx = {"Public/GustavX/Other/Nothing.txt": b"x"}
    return {"Shared.pak": shared, "Gustav.pak": gustav, "GustavX.pak": gustavx}


HANDLES = ["hFighter", "hFighterDesc", "hElf", "hElfDesc", "hAcolyte", "hAcolyteDesc", "hAlert", "hAlertDesc",
           "hFighterPassive", "hAlertPassive", "hFireBolt2", "hBoots", "hBootsDesc", "hBase", "hFancy"]
FRENCH = {"hFighter": "Guerrier", "hFireBolt2": "Trait de feu", "hBase": "Épée"}
WIKI = {"source": "https://example.org", "license": "test", "items": {
    "MAG_Boots": {"uuid": "t-boots", "kind": "equipment", "rarity": "rare", "legacy": None, "locations": []},
    "WPN_Sword": {"uuid": None, "kind": "weapon", "rarity": "common", "legacy": None, "locations": []},
    "WPN_Sword_Fancy": {"uuid": "t-fancy", "kind": "weapon", "rarity": "common", "legacy": None, "locations": []},
    "MAG_Gone": {"uuid": None, "kind": "equipment", "rarity": "rare", "legacy": "unobtainable", "locations": []},
}}


def make_game(drop_french: str | None = None) -> tuple[Path, tempfile.TemporaryDirectory]:
    folder = tempfile.TemporaryDirectory()
    game = Path(folder.name)
    data = game / "Data"
    (data / "Localization" / "French").mkdir(parents=True)
    for name, files in rules_files().items():
        (data / name).write_bytes(fixtures.pak(files))
    en = [(h, 1, f"EN {h}") for h in HANDLES]
    fr = [(h, 1, FRENCH.get(h, f"FR {h}")) for h in HANDLES if h != drop_french]
    (data / "Localization" / "English.pak").write_bytes(
        fixtures.pak({"Localization/English/english.loca": fixtures.loca(en)}))
    (data / "Localization" / "French" / "French.pak").write_bytes(
        fixtures.pak({"Localization/French/french.loca": fixtures.loca(fr)}))
    return game, folder


FILES = ["meta.json", "rules.json", "texts.en.json", "texts.fr.json"]


# Committed lists that describe the real game; the synthetic game gets empty ones.
LISTS = ("GAME_TYPOS", "KNOWN_DUPLICATES", "UNNAMED", "ITEMS_EXCLUDED")


class ImporterTest(unittest.TestCase):
    def setUp(self):
        self.game, folder = make_game()
        self.addCleanup(folder.cleanup)
        out = tempfile.TemporaryDirectory()
        self.addCleanup(out.cleanup)
        self.out = Path(out.name) / "larian"
        self.lists = Path(out.name)
        for name in LISTS:
            self.set_list(name, "")
        self.wiki = self.lists / "items.json"
        self.write_wiki(WIKI)
        patcher = mock.patch.object(importer, "WIKI", self.wiki)
        patcher.start()
        self.addCleanup(patcher.stop)

    def write_wiki(self, wiki: dict, path: Path | None = None) -> None:
        (path or self.wiki).write_text(json.dumps(wiki), encoding="utf-8")

    def set_list(self, name: str, text: str) -> None:
        path = self.lists / f"{name}.txt"
        path.write_text(text, encoding="utf-8")
        patcher = mock.patch.object(importer, name, path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_listed_game_typo_corrected(self):
        files = rules_files()
        progressions = "Public/Shared/Progressions/Progressions.lsx"
        files["Shared.pak"][progressions] = files["Shared.pak"][progressions].replace(
            b"AddSpells(l-spells)", b"AddSpells(l-spells))")
        (self.game / "Data" / "Shared.pak").write_bytes(fixtures.pak(files["Shared.pak"]))
        with self.assertRaises(importer.model.ModelError):
            importer.build(self.game, "1.2.3")
        self.set_list("GAME_TYPOS", "AddSpells(l-spells)) => AddSpells(l-spells)  # test typo\n")
        rules = importer.build(self.game, "1.2.3")["rules.json"]
        self.assertEqual(rules["progressions"][0]["selectors"][1]["list"], "l-spells")

    def test_end_to_end_synthetic(self):
        importer.run(self.game, self.out, "1.2.3")
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), FILES)
        fr = json.loads((self.out / "texts.fr.json").read_text(encoding="utf-8"))
        self.assertEqual(fr["class:Fighter"]["name"], "Guerrier")
        self.assertEqual(fr["spell:Target_FireBolt"]["name"], "Trait de feu")
        rules = json.loads((self.out / "rules.json").read_text(encoding="utf-8"))
        self.assertEqual(rules["spells"]["Target_FireBolt"]["school"], "Evocation")
        self.assertEqual(sorted(rules["races"]), ["Elf"])
        self.assertNotIn("text", rules["classes"]["Fighter"])
        meta = json.loads((self.out / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["game"], "1.2.3")
        self.assertEqual(meta["modules"], ["Shared", "SharedDev", "Gustav", "GustavDev", "GustavX"])
        self.assertEqual(meta["notice"]["en"], "Non-commercial fan project; content owned by Larian Studios.")
        self.assertEqual(meta["notice"]["fr"], "Projet de fans non commercial ; contenu propriété de Larian Studios.")

    def test_items_end_to_end(self):
        importer.run(self.game, self.out, "1.2.3")
        rules = json.loads((self.out / "rules.json").read_text(encoding="utf-8"))
        self.assertEqual(rules["items"], {
            "MAG_Boots": {"kind": "equipment", "found_by": "stats", "stats_type": "Armor", "slot": "Boots",
                          "rarity": "Rare", "root_template": "t-boots"},
            "WPN_Sword": {"kind": "weapon", "found_by": "stats", "stats_type": "Weapon", "slot": "Melee Main Weapon",
                          "rarity": None, "root_template": "t-sword"},
            "WPN_Sword_Fancy": {"kind": "weapon", "found_by": "template", "stats_type": "Weapon",
                                "slot": "Melee Main Weapon", "rarity": None, "root_template": "t-fancy"}})
        en = json.loads((self.out / "texts.en.json").read_text(encoding="utf-8"))
        fr = json.loads((self.out / "texts.fr.json").read_text(encoding="utf-8"))
        self.assertEqual(en["item:MAG_Boots"], {"name": "EN hBoots", "description": "EN hBootsDesc"})
        self.assertEqual(fr["item:WPN_Sword"], {"name": "Épée", "description": None})
        self.assertEqual(en["item:WPN_Sword_Fancy"], {"name": "EN hFancy", "description": None})
        self.assertNotIn("item:MAG_Gone", en)

    def test_wiki_option(self):
        other = self.lists / "other.json"
        self.write_wiki({**WIKI, "items": {"MAG_Boots": WIKI["items"]["MAG_Boots"]}}, other)
        code = importer.main(["--game", str(self.game), "--game-version", "1.2.3", "--output", str(self.out),
                              "--wiki", str(other)])
        self.assertEqual(code, 0)
        rules = json.loads((self.out / "rules.json").read_text(encoding="utf-8"))
        self.assertEqual(sorted(rules["items"]), ["MAG_Boots"])

    def test_missing_wiki_file(self):
        with mock.patch("sys.stderr") as stderr:
            code = importer.main(["--game", str(self.game), "--game-version", "1.2.3", "--output", str(self.out),
                                  "--wiki", str(self.lists / "none.json")])
        self.assertEqual(code, 1)
        self.assertIn("none.json", "".join(c.args[0] for c in stderr.write.call_args_list))
        self.assertFalse(self.out.exists())

    def test_item_errors_listed_with_rules_errors(self):
        wiki = json.loads(json.dumps(WIKI))
        wiki["items"]["WPN_Axe"] = {"uuid": None, "kind": "weapon", "rarity": None, "legacy": None, "locations": []}
        wiki["items"]["MAG_Boots"]["uuid"] = "t-other"
        self.write_wiki(wiki)
        game, folder = make_game(drop_french="hAlertDesc")
        self.addCleanup(folder.cleanup)
        with mock.patch("sys.stderr") as stderr:
            code = importer.main(["--game", str(game), "--game-version", "1.2.3", "--output", str(self.out)])
        self.assertEqual(code, 1)
        printed = "".join(c.args[0] for c in stderr.write.call_args_list)
        self.assertIn("item WPN_Axe", printed)
        self.assertIn("t-other", printed)
        self.assertFalse(self.out.exists())
        self.set_list("ITEMS_EXCLUDED", "WPN_Axe  # test exclusion\n")
        wiki["items"]["MAG_Boots"]["uuid"] = "t-boots"
        self.write_wiki(wiki)
        importer.run(self.game, self.out, "1.2.3")
        self.assertNotIn("WPN_Axe", json.loads((self.out / "rules.json").read_text(encoding="utf-8"))["items"])

    def test_write_json_format(self):
        path = self.out / "x.json"
        self.out.mkdir(parents=True)
        importer.write_json(path, {"b": "é", "a": [1]})
        self.assertEqual(path.read_bytes(), '{\n "a": [\n  1\n ],\n "b": "é"\n}\n'.encode("utf-8"))

    def test_two_runs_identical(self):
        importer.run(self.game, self.out, "1.2.3")
        first = {f: (self.out / f).read_bytes() for f in FILES}
        importer.run(self.game, self.out, "1.2.3")
        self.assertEqual({f: (self.out / f).read_bytes() for f in FILES}, first)

    def test_failure_writes_nothing(self):
        game, folder = make_game(drop_french="hAlertDesc")
        self.addCleanup(folder.cleanup)
        self.out.mkdir(parents=True)
        (self.out / "rules.json").write_text("previous", encoding="utf-8")
        with mock.patch("sys.stderr") as stderr:
            code = importer.main(["--game", str(game), "--game-version", "1.2.3", "--output", str(self.out)])
        self.assertEqual(code, 1)
        printed = "".join(c.args[0] for c in stderr.write.call_args_list)
        self.assertIn("feat:Alert", printed)
        self.assertIn("hAlertDesc", printed)
        self.assertEqual([p.name for p in self.out.iterdir()], ["rules.json"])
        self.assertEqual((self.out / "rules.json").read_text(encoding="utf-8"), "previous")

    def test_game_from_environment(self):
        with mock.patch.dict(os.environ, {"BG3_GAME": str(self.game)}):
            code = importer.main(["--game-version", "1.2.3", "--output", str(self.out)])
        self.assertEqual(code, 0)
        self.assertEqual(sorted(p.name for p in self.out.iterdir()), FILES)

    def test_game_required(self):
        env = {k: v for k, v in os.environ.items() if k != "BG3_GAME"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch("sys.stderr"):
            with self.assertRaises(SystemExit) as ctx:
                importer.main(["--game-version", "1.2.3", "--output", str(self.out)])
        self.assertNotEqual(ctx.exception.code, 0)
        self.assertFalse(self.out.exists())


if __name__ == "__main__":
    unittest.main()
