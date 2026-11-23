import unittest

from scripts.data import selectors


class TestSelectors(unittest.TestCase):
    def test_select_spells_with_resource(self):
        self.assertEqual(selectors.parse("SelectSpells(u1,2,0,,,u2)"), [{"function": "SelectSpells", "list": "u1", "count": 2, "swaps": 0, "id": None, "ability": None, "resource": "u2", "prepare": None, "cooldown": None, "class": None}])

    def test_select_spells_class(self):
        r = selectors.parse("SelectSpells(u,1,0,MIBardSpells,Charisma,None,AlwaysPrepared,UntilRest,u2)")[0]
        self.assertEqual(r["class"], "u2")
        self.assertEqual(r["resource"], "None")
        self.assertEqual(r["cooldown"], "UntilRest")

    def test_select_spells_ten_arguments(self):
        with self.assertRaises(selectors.UnknownSelector):
            selectors.parse("SelectSpells(a,1,0,d,e,f,g,h,i,j)")

    def test_missing_arguments_are_none(self):
        self.assertEqual(selectors.parse("AddSpells(v)"), [{"function": "AddSpells", "list": "v", "id": None, "ability": None, "resource": None, "prepare": None, "cooldown": None}])

    def test_too_many_arguments(self):
        with self.assertRaises(selectors.UnknownSelector):
            selectors.parse("SelectSkills(u,2,id,x)")

    def test_racial_bonus(self):
        self.assertEqual(selectors.parse("SelectAbilityBonus(u,AbilityBonus,2,1)")[0]["bonuses"], [2, 1])

    def test_several(self):
        self.assertEqual(len(selectors.parse("SelectSkills(u,2);AddSpells(v)")), 2)

    def test_trailing_semicolon_and_empty(self):
        self.assertEqual(len(selectors.parse("SelectSkills(u,2);")), 1)
        self.assertEqual(selectors.parse(""), [])

    def test_unknown(self):
        with self.assertRaises(selectors.UnknownSelector) as c:
            selectors.parse("SelectMagic(u,1)")
        self.assertIn("SelectMagic(u,1)", str(c.exception))

    def test_invalid_integer(self):
        with self.assertRaises(selectors.UnknownSelector):
            selectors.parse("SelectSkills(u,two)")

    def test_expertise(self):
        r = selectors.parse("SelectSkillsExpertise(u,2,true,i)")[0]
        self.assertIs(r["requires_proficiency"], True)
        self.assertEqual(r["id"], "i")
        with self.assertRaises(selectors.UnknownSelector):
            selectors.parse("SelectSkillsExpertise(u,2,yes)")

    def test_abilities(self):
        r = selectors.parse("SelectAbilities(u,2,3,i)")[0]
        self.assertEqual((r["count"], r["max"], r["id"]), (2, 3, "i"))

    def test_passives_equipment(self):
        for f in ("SelectPassives", "ReplacePassives", "SelectEquipment"):
            self.assertEqual(selectors.parse(f"{f}(u,1,i)"), [{"function": f, "list": "u", "count": 1, "id": "i"}])

    def test_unbalanced_parentheses(self):
        for text in ("AddSpells(abc,,,,AlwaysPrepared))", "AddSpells(abc", "AddSpells(a)(b)", "AddSpells(a)x)",
                     "AddSpells(a))(b"):
            with self.assertRaises(selectors.UnknownSelector, msg=text):
                selectors.parse(text)
        with self.assertRaises(selectors.UnknownSelector):
            selectors.requirements("FeatRequirementProficiency('x'))")

    def test_segments_split_without_validating(self):
        self.assertEqual(selectors.segments(" A(x);B(y)) ;"), ["A(x)", "B(y)) ;"])

    def test_requirement(self):
        self.assertEqual(selectors.requirements("FeatRequirementAbilityGreaterEqual('Dexterity',13)"), [{"type": "ability_min", "ability": "Dexterity", "value": 13}])

    def test_proficiency_requirement_and_several(self):
        self.assertEqual(
            selectors.requirements("FeatRequirementProficiency('MediumArmor');FeatRequirementProficiency('LightArmor')"),
            [{"type": "proficiency", "proficiency": "MediumArmor"}, {"type": "proficiency", "proficiency": "LightArmor"}],
        )
        self.assertEqual(selectors.requirements(""), [])

    def test_unknown_requirement(self):
        with self.assertRaises(selectors.UnknownSelector):
            selectors.requirements("FeatRequirementMagic('x')")
        with self.assertRaises(selectors.UnknownSelector):
            selectors.requirements("FeatRequirementAbilityGreaterEqual('Dexterity',thirteen)")
