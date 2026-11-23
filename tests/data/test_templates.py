import unittest

from scripts.data import templates


def node(key, name="N", parent="", display="", desc="", stats="", type_="item"):
    attrs = {"Name": name, "Type": type_, "ParentTemplateId": parent, "DisplayName": display,
             "Description": desc, "Stats": stats}
    if key is not None:
        attrs["MapKey"] = key
    return {"id": "GameObjects", "attributes": attrs, "children": []}


class TemplatesTest(unittest.TestCase):
    def test_later_layer_replaces_template(self):
        merged = templates.merge([[node("a", "Old", display="h1")], [node("a", "New")]])
        self.assertEqual(merged["a"]["attributes"]["Name"], "New")
        self.assertEqual(templates.resolve(merged)["a"]["display_name"], None)

    def test_display_name_inherited_from_parent(self):
        merged = templates.merge([[node("p", display="hp", desc="dp", stats="S"),
                                   node("m", parent="p"), node("c", parent="m", display="hc")]])
        r = templates.resolve(merged)
        self.assertEqual(r["m"], {"name": "N", "type": "item", "stats": "S", "display_name": "hp",
                                  "description": "dp", "parent": "p"})
        self.assertEqual(r["c"]["display_name"], "hc")
        self.assertEqual(r["c"]["description"], "dp")
        self.assertIsNone(r["p"]["parent"])

    def test_inherited_across_layers(self):
        merged = templates.merge([[node("p", display="hp")], [node("c", parent="p")]])
        self.assertEqual(templates.resolve(merged)["c"]["display_name"], "hp")

    def test_missing_parent_reported(self):
        with self.assertRaises(templates.TemplateError) as cm:
            templates.resolve(templates.merge([[node("c", parent="gone")]]))
        self.assertEqual(len(cm.exception.errors), 1)
        self.assertIn("gone", cm.exception.errors[0])

    def test_cycle_reported(self):
        merged = templates.merge([[node("a", parent="b"), node("b", parent="a")]])
        with self.assertRaises(templates.TemplateError) as cm:
            templates.resolve(merged)
        self.assertTrue(any("cycle" in e for e in cm.exception.errors))

    def test_all_errors_together(self):
        merged = templates.merge([[node("a", parent="b"), node("b", parent="a"), node("c", parent="gone"),
                                   node("d", parent="a")]])
        with self.assertRaises(templates.TemplateError) as cm:
            templates.resolve(merged)
        errors = cm.exception.errors
        self.assertEqual(sum("cycle" in e for e in errors), 1)
        self.assertEqual(sum("missing parent" in e for e in errors), 1)

    def test_template_without_mapkey_is_error(self):
        with self.assertRaises(templates.TemplateError):
            templates.merge([[node(None)]])


if __name__ == "__main__":
    unittest.main()
