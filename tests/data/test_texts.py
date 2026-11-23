import copy
import tempfile
import unittest
from pathlib import Path

from scripts.data import texts


def rules() -> dict:
    return {
        "classes": {"Fighter": {"hp": 10, "text": {"name": "hFighter", "description": "hFighterDesc"}}},
        "races": {},
        "backgrounds": {},
        "feats": {"Sharpshooter": {"text": {"name": "hFeat", "description": None}}},
        "spells": {},
        "passives": {"Sharpshooter": {"text": {"name": "hPassive", "description": "hPassiveDesc"}}},
        "progressions": {"p1": {"level": 1}},
        "lists": {"l1": {"items": []}},
    }


EN = {"hFighter": "Fighter", "hFighterDesc": "<LSTag>Strong</LSTag> [1]", "hFeat": "Sharpshooter",
      "hPassive": "Sharpshooter (passive)", "hPassiveDesc": "Aim."}
FR = {"hFighter": "Guerrier", "hFighterDesc": "Fort", "hFeat": "Tireur d'elite",
      "hPassive": "Tireur (passif)", "hPassiveDesc": "Viser."}


class TextsTest(unittest.TestCase):
    def test_name_and_description_in_both_languages(self):
        _, en, fr = texts.resolve(rules(), EN, FR, set())
        self.assertEqual(en["class:Fighter"], {"name": "Fighter", "description": "<LSTag>Strong</LSTag> [1]"})
        self.assertEqual(fr["class:Fighter"], {"name": "Guerrier", "description": "Fort"})
        self.assertEqual(en["feat:Sharpshooter"], {"name": "Sharpshooter", "description": None})

    def test_missing_french_lists_every_case(self):
        fr = {k: v for k, v in FR.items() if k not in ("hFighter", "hPassiveDesc")}
        with self.assertRaises(texts.MissingText) as ctx:
            texts.resolve(rules(), EN, fr, set())
        self.assertEqual(len(ctx.exception.errors), 2)
        joined = "\n".join(ctx.exception.errors)
        self.assertIn("class:Fighter", joined)
        self.assertIn("passive:Sharpshooter", joined)

    def test_empty_or_blank_translation_is_missing(self):
        for table, handle in ((dict(FR, hFighter=""), "hFighter"), (dict(FR, hFighterDesc="  \n"), "hFighterDesc")):
            with self.assertRaises(texts.MissingText) as ctx:
                texts.resolve(rules(), EN, table, set())
            self.assertEqual(len(ctx.exception.errors), 1)
            self.assertIn(handle, ctx.exception.errors[0])

    def test_missing_name_and_description_give_two_errors(self):
        fr = {k: v for k, v in FR.items() if k not in ("hFighter", "hFighterDesc")}
        with self.assertRaises(texts.MissingText) as ctx:
            texts.resolve(rules(), EN, fr, set())
        self.assertEqual(len(ctx.exception.errors), 2)

    def test_missing_name_handle_is_an_error(self):
        r = rules()
        r["feats"]["Sharpshooter"]["text"]["name"] = None
        with self.assertRaises(texts.MissingText) as ctx:
            texts.resolve(r, EN, FR, set())
        self.assertEqual(len(ctx.exception.errors), 1)
        self.assertIn("feat:Sharpshooter", ctx.exception.errors[0])

    def test_unnamed_excludes(self):
        r = rules()
        r["feats"]["Sharpshooter"]["text"]["name"] = None
        for unnamed in ({"feat:Sharpshooter"}, {"Sharpshooter"}):
            _, en, fr = texts.resolve(r, EN, FR, unnamed) if unnamed == {"feat:Sharpshooter"} else (
                texts.resolve({**r, "passives": {}}, EN, FR, unnamed))
            self.assertNotIn("feat:Sharpshooter", en)
            self.assertNotIn("feat:Sharpshooter", fr)

    def test_unnamed_not_found_is_an_error(self):
        r = rules()
        r["feats"]["Sharpshooter"]["text"]["name"] = None
        with self.assertRaises(texts.MissingText) as ctx:
            texts.resolve(r, EN, FR, {"feat:Sharpshooter", "spell:Ghost", "Phantom"})
        self.assertEqual(len(ctx.exception.errors), 2)
        joined = "\n".join(ctx.exception.errors)
        self.assertIn("spell:Ghost: listed as unnamed but not found", joined)
        self.assertIn("Phantom: listed as unnamed but not found", joined)

    def test_unnamed_with_both_texts_is_an_error(self):
        with self.assertRaises(texts.MissingText) as ctx:
            texts.resolve(rules(), EN, FR, {"class:Fighter"})
        self.assertEqual(ctx.exception.errors,
                         ["class:Fighter: listed as unnamed but has texts in both languages; remove it"])
        # Still listed legitimately when one language lacks a text.
        fr = {k: v for k, v in FR.items() if k != "hFighter"}
        _, en, _ = texts.resolve(rules(), EN, fr, {"class:Fighter"})
        self.assertNotIn("class:Fighter", en)

    def test_same_id_two_categories(self):
        _, en, fr = texts.resolve(rules(), EN, FR, set())
        self.assertEqual(en["feat:Sharpshooter"]["name"], "Sharpshooter")
        self.assertEqual(en["passive:Sharpshooter"]["name"], "Sharpshooter (passive)")
        self.assertEqual(fr["passive:Sharpshooter"]["description"], "Viser.")

    def test_text_field_removed_and_input_untouched(self):
        r = rules()
        before = copy.deepcopy(r)
        out, _, _ = texts.resolve(r, EN, FR, set())
        self.assertEqual(r, before)
        self.assertNotIn("text", out["classes"]["Fighter"])
        self.assertEqual(out["classes"]["Fighter"]["hp"], 10)
        self.assertEqual(out["progressions"], r["progressions"])
        self.assertEqual(out["lists"], r["lists"])

    def test_read_unnamed_ignores_comments(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "u.txt"
            p.write_text("# header\nA\n\n  B  # why\n# C\n", encoding="utf-8")
            self.assertEqual(texts.read_unnamed(p), {"A", "B"})


if __name__ == "__main__":
    unittest.main()
