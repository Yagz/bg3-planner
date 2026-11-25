import unittest

from scripts.data import lsx, rulesets
from tests.data.test_importer import lsx as lsx_file


def merged(node_type: str, *nodes: dict) -> dict:
    return lsx.merge([lsx.nodes(lsx_file(node_type, *nodes), node_type)])


def ruleset(uuid: str, name: str, **attributes: str) -> dict:
    return {"UUID": uuid, "Name": name, "DisplayName": f"h{name};1", "Description": f"h{name}Desc;1", **attributes}


def modifier(uuid: str, name: str, kind: str, default: str, **attributes: str) -> dict:
    return {"UUID": uuid, "Name": name, "RulesetModifierType": kind, "Default": default, **attributes}


RULESETS = (ruleset("r-easy", "DIFFICULTY_EASY", ShowInCustom="true"), ruleset("r-hard", "DIFFICULTY_HARD", ShowInCustom="true"),
            ruleset("r-test", "RULESET_TEST"), ruleset("r-honour", "RULESET_HONOUR", ShowInCustom="true"))
MODIFIERS = (modifier("m-multi", "MULTICLASSING", "4", "true", ShowInCustom="true", EditableDuringGame="false"),
             modifier("m-prof", "PROFICIENCY_BONUS", "1", "0", Min="-1", Max="4", Step="1", ShowInCustom="true"),
             modifier("m-honour", "HONOUR_STATS", "4", "false", LoadModule="HonourX"),
             modifier("m-other", "AI_LETHALITY", "3", "AILETHALITY_BALANCED", ShowInCustom="true"))
VALUES = ({"UUID": "v1", "Ruleset": "r-easy", "Modifier": "m-multi", "Value": "false"},
          {"UUID": "v2", "Ruleset": "r-easy", "Modifier": "m-prof", "Value": "2"},
          {"UUID": "v3", "Ruleset": "r-easy", "Modifier": "m-other", "Value": "AILETHALITY_FORGIVING"},
          {"UUID": "v4", "Ruleset": "r-honour", "Modifier": "m-honour", "Value": "true"},
          {"UUID": "v5", "Ruleset": "r-test", "Modifier": "m-multi", "Value": "false"})


def build(rulesets_=RULESETS, modifiers=MODIFIERS, values=VALUES):
    return rulesets.build(merged("Ruleset", *rulesets_), merged("RulesetModifier", *modifiers),
                          merged("RulesetValue", *values))


class RulesetsTest(unittest.TestCase):
    def test_shown_rulesets_with_build_values(self):
        shown, _, errors = build()
        self.assertEqual(errors, [])
        self.assertEqual({k: v["order"] for k, v in shown.items()}, {"DIFFICULTY_EASY": 0, "DIFFICULTY_HARD": 1, "RULESET_HONOUR": 2})
        self.assertEqual(shown["DIFFICULTY_EASY"]["values"], {"MULTICLASSING": False, "PROFICIENCY_BONUS": 2})
        self.assertEqual(shown["DIFFICULTY_HARD"]["values"], {})
        self.assertEqual(shown["RULESET_HONOUR"]["values"], {"HONOUR_STATS": True})
        self.assertEqual(shown["DIFFICULTY_EASY"]["text"], {"name": "hDIFFICULTY_EASY", "description": "hDIFFICULTY_EASYDesc"})
        self.assertNotIn("RULESET_TEST", shown)

    def test_modifier_definitions(self):
        _, modifiers, errors = build()
        self.assertEqual(errors, [])
        self.assertEqual(modifiers, {
            "MULTICLASSING": {"type": "bool", "default": True, "custom": True},
            "PROFICIENCY_BONUS": {"type": "int", "default": 0, "min": -1, "max": 4, "custom": True},
            "HONOUR_STATS": {"type": "bool", "default": False, "custom": False}})

    def test_errors_listed(self):
        modifiers = (MODIFIERS[1], modifier("m-multi", "MULTICLASSING", "3", "true"),
                     modifier("m-honour", "HONOUR_STATS", "2", "0.5"))
        values = ({"UUID": "v1", "Ruleset": "r-easy", "Modifier": "m-prof", "Value": "9"},
                  {"UUID": "v2", "Ruleset": "r-easy", "Modifier": "m-honour", "Value": "yes"},
                  {"UUID": "v3", "Ruleset": "r-nope", "Modifier": "m-prof", "Value": "1"},
                  {"UUID": "v4", "Ruleset": "r-easy", "Modifier": "m-nope", "Value": "1"})
        _, _, errors = build(modifiers=modifiers, values=values)
        joined = "\n".join(errors)
        self.assertEqual(len(errors), 5, joined)
        for word in ("MULTICLASSING", "HONOUR_STATS", "PROFICIENCY_BONUS", "9 is outside -1..4", "r-nope", "m-nope"):
            self.assertIn(word, joined)

    def test_missing_build_modifier(self):
        _, _, errors = build(modifiers=MODIFIERS[:2], values=())
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("HONOUR_STATS", errors[0])

    def test_two_values_for_one_ruleset_and_modifier(self):
        values = VALUES + ({"UUID": "v6", "Ruleset": "r-easy", "Modifier": "m-prof", "Value": "3"},)
        _, _, errors = build(values=values)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("PROFICIENCY_BONUS", errors[0])
        self.assertIn("second value", errors[0])

    def test_non_boolean_value(self):
        values = ({"UUID": "v1", "Ruleset": "r-easy", "Modifier": "m-multi", "Value": "yes"},)
        _, _, errors = build(values=values)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("MULTICLASSING", errors[0])


if __name__ == "__main__":
    unittest.main()
