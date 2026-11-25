import tempfile
import unittest
from pathlib import Path

from scripts.data import texts, ui_names

EN = {"h-ath": "Athletics", "h-ath2": "Athletics", "h-soh": "Sleight of Hand", "h-str": "Strength",
      "h-str2": "Strength", "h-dec": "Deception", "h-dec2": "Deception", "h-other": "Athletics (feat)"}
FR = {"h-ath": "Athlétisme", "h-ath2": "Athlétisme", "h-soh": "Escamotage", "h-str": "Force",
      "h-str2": "Intensité", "h-dec": "Supercherie", "h-dec2": "Tromperie", "h-other": "Athlétisme (don)"}


class LabelTest(unittest.TestCase):
    def test_label_derivation(self):
        self.assertEqual(ui_names.label("SleightOfHand"), "Sleight of Hand")
        self.assertEqual(ui_names.label("AnimalHandling"), "Animal Handling")
        self.assertEqual(ui_names.label("Acrobatics"), "Acrobatics")


class ResolveTest(unittest.TestCase):
    def test_unique_french_text(self):
        en, fr = ui_names.resolve({"skill": ["Athletics", "SleightOfHand"]}, EN, FR, {})
        self.assertEqual(en["skill:Athletics"], {"name": "Athletics", "description": None})
        self.assertEqual(fr["skill:Athletics"], {"name": "Athlétisme", "description": None})
        self.assertEqual(fr["skill:SleightOfHand"], {"name": "Escamotage", "description": None})

    def test_ambiguous_and_missing_are_errors(self):
        with self.assertRaises(texts.MissingText) as ctx:
            ui_names.resolve({"skill": ["Deception", "Insight"], "ability": ["Strength"]}, EN, FR, {})
        errors = ctx.exception.errors
        self.assertEqual(len(errors), 3, errors)
        joined = "\n".join(errors)
        for word in ("skill:Deception", "h-dec2", "Tromperie", "skill:Insight", "'Insight'", "ability:Strength",
                     "Intensité"):
            self.assertIn(word, joined)

    def test_listed_handle_settles_an_ambiguity(self):
        en, fr = ui_names.resolve({"ability": ["Strength"]}, EN, FR, {"ability:Strength": "h-str"})
        self.assertEqual(en["ability:Strength"], {"name": "Strength", "description": None})
        self.assertEqual(fr["ability:Strength"], {"name": "Force", "description": None})

    def test_listed_entry_must_stay_exact(self):
        cases = {"unambiguous": ({"skill": ["Athletics"]}, {"skill:Athletics": "h-ath"}, "remove it"),
                 "unknown id": ({"skill": ["Athletics"]}, {"skill:Nowhere": "h-ath"}, "not found"),
                 "absent handle": ({"ability": ["Strength"]}, {"ability:Strength": "h-none"}, "h-none")}
        for name, (ids, listed, word) in cases.items():
            with self.subTest(name), self.assertRaises(texts.MissingText) as ctx:
                ui_names.resolve(ids, EN, FR, listed)
            self.assertIn(word, "\n".join(ctx.exception.errors))


class ReadListedTest(unittest.TestCase):
    def read(self, text: str) -> dict[str, str]:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "ui_names.txt"
            path.write_text(text, encoding="utf-8")
            return ui_names.read_listed(path)

    def test_format(self):
        self.assertEqual(self.read("# header\n\nability:Strength h-str  # the ability, not the power\n"),
                         {"ability:Strength": "h-str"})
        for bad in ("ability:Strength h-str\n", "Strength h-str  # no kind\n", "spell:Fire h-1  # bad kind\n",
                    "ability:Strength  # no handle\n", "ability:Strength h-1  # a\nability:Strength h-2  # b\n"):
            with self.subTest(bad), self.assertRaises(ValueError):
                self.read(bad)

    def test_committed_file_reads(self):
        self.assertIsInstance(ui_names.read_listed(ui_names.UI_NAMES), dict)


if __name__ == "__main__":
    unittest.main()
