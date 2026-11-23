import unittest

from scripts.donnees import selecteurs


class TestSelecteurs(unittest.TestCase):
    def test_select_spells_avec_ressource(self):
        self.assertEqual(selecteurs.analyser("SelectSpells(u1,2,0,,,u2)"), [{"fonction": "SelectSpells", "liste": "u1", "nombre": 2, "remplacements": 0, "id": None, "caracteristique": None, "ressource": "u2", "preparation": None, "recharge": None, "classe": None}])

    def test_select_spells_classe(self):
        r = selecteurs.analyser("SelectSpells(u,1,0,MIBardSpells,Charisma,None,AlwaysPrepared,UntilRest,u2)")[0]
        self.assertEqual(r["classe"], "u2")
        self.assertEqual(r["ressource"], "None")
        self.assertEqual(r["recharge"], "UntilRest")

    def test_select_spells_dix_arguments(self):
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.analyser("SelectSpells(a,1,0,d,e,f,g,h,i,j)")

    def test_arguments_manquants_none(self):
        self.assertEqual(selecteurs.analyser("AddSpells(v)"), [{"fonction": "AddSpells", "liste": "v", "id": None, "caracteristique": None, "ressource": None, "preparation": None, "recharge": None}])

    def test_trop_d_arguments(self):
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.analyser("SelectSkills(u,2,id,x)")

    def test_bonus_racial(self):
        self.assertEqual(selecteurs.analyser("SelectAbilityBonus(u,AbilityBonus,2,1)")[0]["bonus"], [2, 1])

    def test_plusieurs(self):
        self.assertEqual(len(selecteurs.analyser("SelectSkills(u,2);AddSpells(v)")), 2)

    def test_point_virgule_final_et_vide(self):
        self.assertEqual(len(selecteurs.analyser("SelectSkills(u,2);")), 1)
        self.assertEqual(selecteurs.analyser(""), [])

    def test_inconnu(self):
        with self.assertRaises(selecteurs.SelecteurInconnu) as c:
            selecteurs.analyser("SelectMagic(u,1)")
        self.assertIn("SelectMagic(u,1)", str(c.exception))

    def test_entier_invalide(self):
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.analyser("SelectSkills(u,deux)")

    def test_expertise(self):
        r = selecteurs.analyser("SelectSkillsExpertise(u,2,true,i)")[0]
        self.assertIs(r["maitrise_requise"], True)
        self.assertEqual(r["id"], "i")
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.analyser("SelectSkillsExpertise(u,2,oui)")

    def test_abilities(self):
        r = selecteurs.analyser("SelectAbilities(u,2,3,i)")[0]
        self.assertEqual((r["nombre"], r["maximum"], r["id"]), (2, 3, "i"))

    def test_passifs_equipement(self):
        for f in ("SelectPassives", "ReplacePassives", "SelectEquipment"):
            self.assertEqual(selecteurs.analyser(f"{f}(u,1,i)"), [{"fonction": f, "liste": "u", "nombre": 1, "id": "i"}])

    def test_prerequis(self):
        self.assertEqual(selecteurs.prerequis("FeatRequirementAbilityGreaterEqual('Dexterity',13)"), [{"type": "caracteristique_min", "caracteristique": "Dexterity", "valeur": 13}])

    def test_prerequis_maitrise_et_plusieurs(self):
        self.assertEqual(
            selecteurs.prerequis("FeatRequirementProficiency('MediumArmor');FeatRequirementProficiency('LightArmor')"),
            [{"type": "maitrise", "maitrise": "MediumArmor"}, {"type": "maitrise", "maitrise": "LightArmor"}],
        )
        self.assertEqual(selecteurs.prerequis(""), [])

    def test_prerequis_inconnu(self):
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.prerequis("FeatRequirementMagic('x')")
        with self.assertRaises(selecteurs.SelecteurInconnu):
            selecteurs.prerequis("FeatRequirementAbilityGreaterEqual('Dexterity',treize)")
