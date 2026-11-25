import unittest

from scripts.data import texts, ui_names

SKILL, ABILITY = ui_names.SKILL_HANDLE, ui_names.ABILITY_HANDLE
LABEL = ui_names.LABELS[0][1]
FRENCH_SKILLS = ["Supercherie", "Intimidation", "Représentation", "Persuasion", "Acrobaties", "Escamotage",
                 "Discrétion", "Arcanes", "Histoire", "Investigation", "Nature", "Religion", "Athlétisme", "Dressage",
                 "Perspicacité", "Médecine", "Perception", "Survie"]
FRENCH_ABILITIES = ["Force", "Dextérité", "Constitution", "Intelligence", "Sagesse", "Charisme"]


def tables() -> tuple[dict[str, str], dict[str, str]]:
    """The two indexed families as the game writes them ("Sleight Of Hand"), plus the ability family's `_0`."""
    en = {f"{SKILL}_{i}": ui_names.label(s).replace(" of ", " Of ") for i, s in enumerate(ui_names.SKILLS)}
    fr = {f"{SKILL}_{i}": t for i, t in enumerate(FRENCH_SKILLS)}
    en[LABEL], fr[LABEL] = "Custom Mode", "Mode Personnalisé"
    en |= {f"{ABILITY}_{i + 1}": a for i, a in enumerate(ui_names.ABILITIES)} | {f"{ABILITY}_0": "None"}
    fr |= {f"{ABILITY}_{i + 1}": t for i, t in enumerate(FRENCH_ABILITIES)} | {f"{ABILITY}_0": "Aucune"}
    return en, fr


class LabelTest(unittest.TestCase):
    def test_label_derivation(self):
        self.assertEqual(ui_names.label("SleightOfHand"), "Sleight of Hand")
        self.assertEqual(ui_names.label("AnimalHandling"), "Animal Handling")
        self.assertEqual(ui_names.label("Acrobatics"), "Acrobatics")


class ResolveTest(unittest.TestCase):
    def test_names_read_from_the_indexed_families(self):
        en, fr = ui_names.resolve(*tables())
        self.assertEqual(len(en), 25)
        self.assertEqual(fr["label:customMode"], {"name": "Mode Personnalisé", "description": None})
        self.assertEqual(sorted(en), sorted(fr))
        self.assertEqual(en["skill:SleightOfHand"], {"name": "Sleight Of Hand", "description": None})
        self.assertEqual(fr["skill:Deception"], {"name": "Supercherie", "description": None})
        self.assertEqual(fr["skill:Performance"], {"name": "Représentation", "description": None})
        self.assertEqual(fr["skill:Survival"], {"name": "Survie", "description": None})
        self.assertEqual(fr["ability:Strength"], {"name": "Force", "description": None})
        self.assertEqual(en["ability:Charisma"], {"name": "Charisma", "description": None})

    def test_order_mismatch_and_missing_entries_are_errors(self):
        en, fr = tables()
        en[f"{SKILL}_0"], en[f"{SKILL}_1"] = en[f"{SKILL}_1"], en[f"{SKILL}_0"]
        del fr[f"{ABILITY}_6"]
        del en[f"{SKILL}_17"]
        with self.assertRaises(texts.MissingText) as ctx:
            ui_names.resolve(en, fr)
        joined = "\n".join(ctx.exception.errors)
        self.assertEqual(len(ctx.exception.errors), 4, joined)
        for word in ("skill:Deception", "'Intimidation'", "skill:Intimidation", "ability:Charisma", "French",
                     "skill:Survival", "English"):
            self.assertIn(word, joined)


if __name__ == "__main__":
    unittest.main()
