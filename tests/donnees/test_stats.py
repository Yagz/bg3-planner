import unittest

from scripts.donnees import stats


class TestEntrees(unittest.TestCase):
    def test_lit_une_entree(self):
        e = stats.entrees('new entry "A"\ntype "SpellData"\nusing "P"\ndata "Level" "1"\ndata "Icon" "i"\n')
        self.assertEqual(e, [{"nom": "A", "type": "SpellData", "parent": "P", "data": {"Level": "1", "Icon": "i"}}])

    def test_crlf_blancs_commentaires_et_indentation(self):
        t = '// commentaire\r\n\r\nnew entry "A"\r\ntype "SpellData"\r\n  data "K" "v"\r\n\r\nnew entry "B"\r\ntype "PassiveData"\r\n'
        e = stats.entrees(t)
        self.assertEqual([x["nom"] for x in e], ["A", "B"])
        self.assertEqual(e[0]["data"], {"K": "v"})
        self.assertIsNone(e[1]["parent"])

    def test_valeur_vide_et_espaces(self):
        e = stats.entrees('new entry "A"\ntype "T"\ndata "K" ""\ndata "L" "a b;1"\n')
        self.assertEqual(e[0]["data"], {"K": "", "L": "a b;1"})

    def test_valeur_sur_plusieurs_lignes(self):
        t = ('new entry "A"\ntype "T"\n'
             'data "TargetCeiling" "0.8\n"\n'
             'data "Tip" "Apply(A, 1);\nApply(B, 2);"\n'
             'data "Boosts" "IF(X):Dmg(\n  1d4,\n  Fire\n)"\n'
             'data "Apres" "ok"\n')
        attendu = {"TargetCeiling": "0.8\n", "Tip": "Apply(A, 1);\nApply(B, 2);",
                   "Boosts": "IF(X):Dmg(\n  1d4,\n  Fire\n)", "Apres": "ok"}
        self.assertEqual(stats.entrees(t)[0]["data"], attendu)
        self.assertEqual(stats.entrees(t.replace("\n", "\r\n"))[0]["data"], attendu)

    def test_valeur_non_terminee_en_fin_de_fichier(self):
        with self.assertRaises(stats.ErreurStats) as ctx:
            stats.entrees('new entry "A"\ntype "T"\ndata "K" "abc\nsuite\n')
        self.assertIn("ligne 3", str(ctx.exception))

    def test_valeur_non_terminee_avant_une_nouvelle_entree(self):
        with self.assertRaises(stats.ErreurStats) as ctx:
            stats.entrees('new entry "A"\ntype "T"\ndata "K" "abc\nnew entry "B"\ntype "T"\n')
        self.assertIn("ligne 3", str(ctx.exception))

    def test_valeur_non_terminee_avant_un_data(self):
        with self.assertRaises(stats.ErreurStats) as ctx:
            stats.entrees('new entry "A"\ntype "T"\ndata "K" "abc\n  data "X" "y"\n')
        self.assertIn("ligne 3", str(ctx.exception))

    def test_espaces_de_fin_conserves_sur_la_premiere_ligne(self):
        e = stats.entrees('new entry "A"\ntype "T"\ndata "K" "abc  \nsuite"\n')
        self.assertEqual(e[0]["data"]["K"], "abc  \nsuite")

    def test_ligne_inconnue(self):
        with self.assertRaises(stats.ErreurStats):
            stats.entrees('new entry "A"\ntype "T"\nn_importe_quoi\n')

    def test_data_mal_forme(self):
        with self.assertRaises(stats.ErreurStats):
            stats.entrees('new entry "A"\ntype "T"\ndata "K"\n')

    def test_data_avant_entree(self):
        with self.assertRaises(stats.ErreurStats):
            stats.entrees('data "K" "v"\n')


class TestFusion(unittest.TestCase):
    def test_herite_du_parent_dans_une_autre_couche(self):
        a = stats.entrees('new entry "ARM_Magic_Shoes"\ntype "Armor"\ndata "DisplayName" "hA;1"\n')
        b = stats.entrees('new entry "MAG_Acrobat_Shoes"\ntype "Armor"\nusing "ARM_Magic_Shoes"\ndata "Rarity" "Rare"\n')
        r = stats.fusionner([a, b])
        self.assertEqual(r["MAG_Acrobat_Shoes"]["DisplayName"], "hA;1")

    def test_redefinition_remplace(self):
        a = stats.entrees('new entry "X"\ntype "SpellData"\ndata "Level" "1"\ndata "Icon" "i"\n')
        b = stats.entrees('new entry "X"\ntype "SpellData"\ndata "Level" "2"\n')
        self.assertNotIn("Icon", stats.fusionner([a, b])["X"])

    def test_using_soi_meme_prend_la_definition_precedente(self):
        a = stats.entrees('new entry "X"\ntype "SpellData"\ndata "Level" "1"\ndata "Icon" "i"\n')
        b = stats.entrees('new entry "X"\ntype "SpellData"\nusing "X"\ndata "Level" "2"\n')
        self.assertEqual(stats.fusionner([a, b])["X"], {"type": "SpellData", "Level": "2", "Icon": "i"})

    def test_using_soi_meme_sur_trois_couches(self):
        c = [stats.entrees(t) for t in (
            'new entry "X"\ntype "S"\ndata "A" "1"\n',
            'new entry "X"\ntype "S"\nusing "X"\ndata "B" "2"\n',
            'new entry "X"\ntype "S"\nusing "X"\ndata "C" "3"\n')]
        self.assertEqual(stats.fusionner(c)["X"], {"type": "S", "A": "1", "B": "2", "C": "3"})

    def test_heritage_sur_plusieurs_niveaux_et_surcharge(self):
        a = stats.entrees(
            'new entry "G"\ntype "S"\ndata "K" "g"\ndata "L" "g"\n'
            'new entry "P"\ntype "S"\nusing "G"\ndata "L" "p"\n'
            'new entry "E"\ntype "S"\nusing "P"\n')
        self.assertEqual(stats.fusionner([a])["E"], {"type": "S", "K": "g", "L": "p"})

    def test_type_pris_au_parent_si_absent(self):
        a = stats.entrees('new entry "P"\ntype "Armor"\nnew entry "E"\nusing "P"\n')
        self.assertEqual(stats.fusionner([a])["E"]["type"], "Armor")

    def test_parent_redefini_plus_tard_est_la_derniere_definition(self):
        a = stats.entrees('new entry "P"\ntype "S"\ndata "K" "1"\nnew entry "E"\ntype "S"\nusing "P"\n')
        b = stats.entrees('new entry "P"\ntype "S"\ndata "K" "2"\n')
        self.assertEqual(stats.fusionner([a, b])["E"]["K"], "2")

    def test_redefinition_dans_une_meme_couche(self):
        a = stats.entrees('new entry "X"\ntype "S"\ndata "A" "1"\nnew entry "X"\ntype "S"\ndata "B" "2"\n')
        self.assertEqual(stats.fusionner([a])["X"], {"type": "S", "B": "2"})

    def test_parent_introuvable(self):
        with self.assertRaises(stats.ErreurStats):
            stats.fusionner([stats.entrees('new entry "Y"\ntype "SpellData"\nusing "Absent"\n')])

    def test_using_soi_meme_sans_definition_precedente(self):
        with self.assertRaises(stats.ErreurStats):
            stats.fusionner([stats.entrees('new entry "Y"\ntype "S"\nusing "Y"\n')])

    def test_cycle(self):
        a = stats.entrees('new entry "A"\ntype "S"\nusing "B"\nnew entry "B"\ntype "S"\nusing "A"\n')
        with self.assertRaises(stats.ErreurStats) as ctx:
            stats.fusionner([a])
        self.assertTrue(any("cycle" in e for e in ctx.exception.erreurs))

    def test_toutes_les_erreurs_sont_rapportees(self):
        a = stats.entrees(
            'new entry "A"\ntype "S"\nusing "Absent1"\n'
            'new entry "B"\ntype "S"\nusing "Absent2"\n'
            'new entry "C"\ntype "S"\nusing "D"\nnew entry "D"\ntype "S"\nusing "C"\n')
        with self.assertRaises(stats.ErreurStats) as ctx:
            stats.fusionner([a])
        e = ctx.exception.erreurs
        self.assertTrue(any("Absent1" in x for x in e))
        self.assertTrue(any("Absent2" in x for x in e))
        self.assertTrue(any("cycle" in x for x in e))
        self.assertIn("Absent1", str(ctx.exception))
        self.assertIn("Absent2", str(ctx.exception))

    def test_ne_modifie_pas_les_entrees(self):
        a = stats.entrees('new entry "P"\ntype "S"\ndata "K" "1"\nnew entry "E"\ntype "S"\nusing "P"\n')
        stats.fusionner([a])
        self.assertEqual(a[1]["data"], {})


if __name__ == "__main__":
    unittest.main()
