import re
import tempfile
import unittest
from pathlib import Path

from scripts.data import sources
from tests.data import fixtures

PATTERN = re.compile(r"Lists/SpellLists\.lsx$")


def _list(module: str, content: bytes) -> dict[str, bytes]:
    return {f"Public/{module}/Lists/SpellLists.lsx": content}


class TestSources(unittest.TestCase):
    def _game(self, paks: dict[str, dict[str, bytes]]) -> Path:
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        game = Path(folder.name)
        (game / "Data").mkdir()
        for name, files in paks.items():
            (game / "Data" / name).write_bytes(fixtures.pak(files))
        return game

    def _base_paks(self, hotfix: dict[str, bytes] | None = None) -> dict[str, dict[str, bytes]]:
        return {
            "Shared.pak": {**_list("Shared", b"shared"), **_list("SharedDev", b"sharedDev")},
            "GustavX.pak": {**_list("GustavX", b"gustavx"), **_list("HonourX", b"honourx")},
            "Gustav.pak": _list("Honour", b"honour"),
            "BetterTooltips.pak": _list("Shared", b"mod"),
            "Patch8_HotFix9.pak": hotfix or {"Public/Shared/Other.txt": b"x"},
            "Patch8_HotFix10.pak": {},
        }

    def test_order_and_exclusions(self):
        game = self._game(self._base_paks())
        c = sources.layers(game, PATTERN)
        self.assertEqual([m for m, _, _ in c], ["Shared", "SharedDev", "GustavX"])
        self.assertEqual([p for _, p, _ in c], ["Lists/SpellLists.lsx"] * 3)
        self.assertNotIn(b"mod", b"".join(d for _, _, d in c))

    def test_hotfix_touching_the_rules(self):
        game = self._game(self._base_paks(_list("Shared", b"patch")))
        with self.assertRaises(sources.UnexpectedSource):
            sources.layers(game, PATTERN)

    def test_any_patch_pak_touching_the_rules(self):
        paks = self._base_paks()
        paks["Patch9_Foo.pak"] = _list("Gustav", b"patch")
        with self.assertRaises(sources.UnexpectedSource) as ctx:
            sources.layers(self._game(paks), PATTERN)
        self.assertIn("Patch9_Foo.pak", str(ctx.exception))

    def test_missing_rules_pak(self):
        paks = self._base_paks()
        del paks["Gustav.pak"]
        with self.assertRaises(sources.UnexpectedSource):
            sources.layers(self._game(paks), PATTERN)

    def test_missing_hotfixes_tolerated(self):
        paks = self._base_paks()
        del paks["Patch8_HotFix9.pak"], paks["Patch8_HotFix10.pak"]
        c = sources.layers(self._game(paks), PATTERN)
        self.assertEqual(len(c), 3)



TOOLTIPS = "Public/Game/GUI/Library/Tooltips.xaml"
SHEET = "Public/Game/GUI/Library/CharacterSheetTemplates.xaml"


class TestGameFiles(unittest.TestCase):
    def _game(self, paks: dict[str, dict[str, bytes]]) -> Path:
        return TestSources._game(self, paks)

    def _paks(self, **extra: dict[str, bytes]) -> dict[str, dict[str, bytes]]:
        return {"Game.pak": {TOOLTIPS: b"tooltips", SHEET: b"sheet", "Mods/MainUI/GUI/Library/Tooltips.xaml": b"main"},
                "BetterTooltips.pak": {TOOLTIPS: b"mod"},
                "Patch8_HotFix9.pak": {"Public/Game/GUI/Override/Clairmont/Library/Tooltips.xaml": b"console"},
                **extra}

    def test_reads_the_named_files(self):
        self.assertEqual(sources.game_files(self._game(self._paks()), (TOOLTIPS, SHEET)),
                         {TOOLTIPS: b"tooltips", SHEET: b"sheet"})

    def test_hotfix_holding_a_named_file(self):
        game = self._game(self._paks(**{"Patch9_Foo.pak": {TOOLTIPS: b"patch"}}))
        with self.assertRaises(sources.UnexpectedSource) as ctx:
            sources.game_files(game, (TOOLTIPS, SHEET))
        self.assertIn("Patch9_Foo.pak", str(ctx.exception))

    def test_missing_pak(self):
        paks = self._paks()
        del paks["Game.pak"]
        with self.assertRaises(sources.UnexpectedSource):
            sources.game_files(self._game(paks), (TOOLTIPS,))

    def test_absent_name(self):
        with self.assertRaises(sources.UnexpectedSource) as ctx:
            sources.game_files(self._game(self._paks()), (TOOLTIPS, "Public/Game/GUI/Library/Nope.xaml"))
        self.assertIn("Nope.xaml", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
