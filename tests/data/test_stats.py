import unittest

from scripts.data import stats


class TestEntries(unittest.TestCase):
    def test_reads_an_entry(self):
        e = stats.entries('new entry "A"\ntype "SpellData"\nusing "P"\ndata "Level" "1"\ndata "Icon" "i"\n')
        self.assertEqual(e, [{"name": "A", "type": "SpellData", "parent": "P", "data": {"Level": "1", "Icon": "i"}}])

    def test_crlf_blanks_comments_and_indentation(self):
        t = '// comment\r\n\r\nnew entry "A"\r\ntype "SpellData"\r\n  data "K" "v"\r\n\r\nnew entry "B"\r\ntype "PassiveData"\r\n'
        e = stats.entries(t)
        self.assertEqual([x["name"] for x in e], ["A", "B"])
        self.assertEqual(e[0]["data"], {"K": "v"})
        self.assertIsNone(e[1]["parent"])

    def test_empty_value_and_spaces(self):
        e = stats.entries('new entry "A"\ntype "T"\ndata "K" ""\ndata "L" "a b;1"\n')
        self.assertEqual(e[0]["data"], {"K": "", "L": "a b;1"})

    def test_value_spanning_several_lines(self):
        t = ('new entry "A"\ntype "T"\n'
             'data "TargetCeiling" "0.8\n"\n'
             'data "Tip" "Apply(A, 1);\nApply(B, 2);"\n'
             'data "Boosts" "IF(X):Dmg(\n  1d4,\n  Fire\n)"\n'
             'data "After" "ok"\n')
        expected = {"TargetCeiling": "0.8\n", "Tip": "Apply(A, 1);\nApply(B, 2);",
                   "Boosts": "IF(X):Dmg(\n  1d4,\n  Fire\n)", "After": "ok"}
        self.assertEqual(stats.entries(t)[0]["data"], expected)
        self.assertEqual(stats.entries(t.replace("\n", "\r\n"))[0]["data"], expected)

    def test_unterminated_value_at_end_of_file(self):
        with self.assertRaises(stats.StatsError) as ctx:
            stats.entries('new entry "A"\ntype "T"\ndata "K" "abc\nrest\n')
        self.assertIn("line 3", str(ctx.exception))

    def test_unterminated_value_before_a_new_entry(self):
        with self.assertRaises(stats.StatsError) as ctx:
            stats.entries('new entry "A"\ntype "T"\ndata "K" "abc\nnew entry "B"\ntype "T"\n')
        self.assertIn("line 3", str(ctx.exception))

    def test_unterminated_value_before_a_data_statement(self):
        with self.assertRaises(stats.StatsError) as ctx:
            stats.entries('new entry "A"\ntype "T"\ndata "K" "abc\n  data "X" "y"\n')
        self.assertIn("line 3", str(ctx.exception))

    def test_trailing_spaces_kept_on_the_first_line(self):
        e = stats.entries('new entry "A"\ntype "T"\ndata "K" "abc  \nrest"\n')
        self.assertEqual(e[0]["data"]["K"], "abc  \nrest")

    def test_unknown_line(self):
        with self.assertRaises(stats.StatsError):
            stats.entries('new entry "A"\ntype "T"\nanything_at_all\n')

    def test_malformed_data(self):
        with self.assertRaises(stats.StatsError):
            stats.entries('new entry "A"\ntype "T"\ndata "K"\n')

    def test_data_before_entry(self):
        with self.assertRaises(stats.StatsError):
            stats.entries('data "K" "v"\n')


class TestMerge(unittest.TestCase):
    def test_inherits_from_a_parent_in_another_layer(self):
        a = stats.entries('new entry "ARM_Magic_Shoes"\ntype "Armor"\ndata "DisplayName" "hA;1"\n')
        b = stats.entries('new entry "MAG_Acrobat_Shoes"\ntype "Armor"\nusing "ARM_Magic_Shoes"\ndata "Rarity" "Rare"\n')
        r = stats.merge([a, b])
        self.assertEqual(r["MAG_Acrobat_Shoes"]["DisplayName"], "hA;1")

    def test_redefinition_replaces(self):
        a = stats.entries('new entry "X"\ntype "SpellData"\ndata "Level" "1"\ndata "Icon" "i"\n')
        b = stats.entries('new entry "X"\ntype "SpellData"\ndata "Level" "2"\n')
        self.assertNotIn("Icon", stats.merge([a, b])["X"])

    def test_using_itself_takes_the_previous_definition(self):
        a = stats.entries('new entry "X"\ntype "SpellData"\ndata "Level" "1"\ndata "Icon" "i"\n')
        b = stats.entries('new entry "X"\ntype "SpellData"\nusing "X"\ndata "Level" "2"\n')
        self.assertEqual(stats.merge([a, b])["X"], {"type": "SpellData", "Level": "2", "Icon": "i"})

    def test_using_itself_across_three_layers(self):
        c = [stats.entries(t) for t in (
            'new entry "X"\ntype "S"\ndata "A" "1"\n',
            'new entry "X"\ntype "S"\nusing "X"\ndata "B" "2"\n',
            'new entry "X"\ntype "S"\nusing "X"\ndata "C" "3"\n')]
        self.assertEqual(stats.merge(c)["X"], {"type": "S", "A": "1", "B": "2", "C": "3"})

    def test_multi_level_inheritance_and_override(self):
        a = stats.entries(
            'new entry "G"\ntype "S"\ndata "K" "g"\ndata "L" "g"\n'
            'new entry "P"\ntype "S"\nusing "G"\ndata "L" "p"\n'
            'new entry "E"\ntype "S"\nusing "P"\n')
        self.assertEqual(stats.merge([a])["E"], {"type": "S", "K": "g", "L": "p"})

    def test_type_taken_from_parent_if_absent(self):
        a = stats.entries('new entry "P"\ntype "Armor"\nnew entry "E"\nusing "P"\n')
        self.assertEqual(stats.merge([a])["E"]["type"], "Armor")

    def test_parent_redefined_later_is_the_last_definition(self):
        a = stats.entries('new entry "P"\ntype "S"\ndata "K" "1"\nnew entry "E"\ntype "S"\nusing "P"\n')
        b = stats.entries('new entry "P"\ntype "S"\ndata "K" "2"\n')
        self.assertEqual(stats.merge([a, b])["E"]["K"], "2")

    def test_redefinition_in_the_same_layer(self):
        a = stats.entries('new entry "X"\ntype "S"\ndata "A" "1"\nnew entry "X"\ntype "S"\ndata "B" "2"\n')
        self.assertEqual(stats.merge([a])["X"], {"type": "S", "B": "2"})

    def test_parent_not_found(self):
        with self.assertRaises(stats.StatsError):
            stats.merge([stats.entries('new entry "Y"\ntype "SpellData"\nusing "Absent"\n')])

    def test_using_itself_without_a_previous_definition(self):
        with self.assertRaises(stats.StatsError):
            stats.merge([stats.entries('new entry "Y"\ntype "S"\nusing "Y"\n')])

    def test_cycle(self):
        a = stats.entries('new entry "A"\ntype "S"\nusing "B"\nnew entry "B"\ntype "S"\nusing "A"\n')
        with self.assertRaises(stats.StatsError) as ctx:
            stats.merge([a])
        self.assertTrue(any("cycle" in e for e in ctx.exception.errors))

    def test_all_errors_are_reported(self):
        a = stats.entries(
            'new entry "A"\ntype "S"\nusing "Absent1"\n'
            'new entry "B"\ntype "S"\nusing "Absent2"\n'
            'new entry "C"\ntype "S"\nusing "D"\nnew entry "D"\ntype "S"\nusing "C"\n')
        with self.assertRaises(stats.StatsError) as ctx:
            stats.merge([a])
        e = ctx.exception.errors
        self.assertTrue(any("Absent1" in x for x in e))
        self.assertTrue(any("Absent2" in x for x in e))
        self.assertTrue(any("cycle" in x for x in e))
        self.assertIn("Absent1", str(ctx.exception))
        self.assertIn("Absent2", str(ctx.exception))

    def test_does_not_modify_the_entries(self):
        a = stats.entries('new entry "P"\ntype "S"\ndata "K" "1"\nnew entry "E"\ntype "S"\nusing "P"\n')
        stats.merge([a])
        self.assertEqual(a[1]["data"], {})


if __name__ == "__main__":
    unittest.main()
