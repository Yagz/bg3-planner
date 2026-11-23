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
        # Another stats format, not read.
        "Public/Shared/Stats/Generated/Data/Armor.txt": b"garbage that is not stats",
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
    }
    gustavx = {"Public/GustavX/Other/Nothing.txt": b"x"}
    return {"Shared.pak": shared, "Gustav.pak": gustav, "GustavX.pak": gustavx}


HANDLES = ["hFighter", "hFighterDesc", "hElf", "hElfDesc", "hAcolyte", "hAcolyteDesc", "hAlert", "hAlertDesc",
           "hFighterPassive", "hAlertPassive", "hFireBolt2"]
FRENCH = {"hFighter": "Guerrier", "hFireBolt2": "Trait de feu"}


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
LISTS = ("GAME_TYPOS",)


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
