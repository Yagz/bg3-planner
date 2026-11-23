import unittest

from scripts.data import lsx


def lsx_xml(body: str, region: str = "Progressions") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<save>\n'
        '<version major="4" minor="6" revision="0" build="1"/>\n'
        f'<region id="{region}"><node id="root"><children>{body}</children></node></region>\n'
        "</save>"
    ).encode("utf-8")


def progression(uuid: str | None, extra: str = "", children: str = "") -> str:
    uuid_attr = f'<attribute id="UUID" type="guid" value="{uuid}"/>' if uuid else ""
    block = f"<children>{children}</children>" if children else ""
    return (
        f'<node id="Progression"><attribute id="Name" type="LSString" value="Class"/>'
        f"{uuid_attr}{extra}{block}</node>"
    )


class TestLsx(unittest.TestCase):
    def test_translated_string_gives_the_handle(self):
        xml = lsx_xml(
            '<node id="Race"><attribute id="DisplayName" type="TranslatedString" '
            'handle="h12gabcg" version="1"/></node>'
        )
        [n] = lsx.nodes(xml, "Race")
        self.assertEqual(n["attributes"]["DisplayName"], "h12gabcg")

    def test_entities_decoded(self):
        xml = lsx_xml(
            '<node id="Feat"><attribute id="Requirements" type="LSString" '
            'value="FeatRequirementAbilityGreaterEqual(&apos;Dexterity&apos;,13)"/></node>'
        )
        [n] = lsx.nodes(xml, "Feat")
        self.assertEqual(
            n["attributes"]["Requirements"], "FeatRequirementAbilityGreaterEqual('Dexterity',13)"
        )

    def test_children(self):
        sub = (
            '<node id="SubClasses"><children>'
            '<node id="SubClass"><attribute id="Object" type="guid" value="aaa"/></node>'
            '<node id="SubClass"><attribute id="Object" type="guid" value="bbb"/></node>'
            "</children></node>"
        )
        [n] = lsx.nodes(lsx_xml(progression("u1", children=sub)), "Progression")
        [container] = n["children"]
        self.assertEqual(container["id"], "SubClasses")
        self.assertEqual([e["attributes"]["Object"] for e in container["children"]], ["aaa", "bbb"])

    def test_nodes_filters_the_type_and_keeps_the_order(self):
        xml = lsx_xml(progression("u1") + '<node id="Other"/>' + progression("u2"))
        self.assertEqual([n["attributes"]["UUID"] for n in lsx.nodes(xml, "Progression")], ["u1", "u2"])

    def test_override_by_uuid(self):
        selectors = (
            '<node id="Selectors"><children><node id="S"/></children></node>'
        )
        c1 = lsx.nodes(lsx_xml(progression("u1", children=selectors)), "Progression")
        c2 = lsx.nodes(lsx_xml(progression("u1")), "Progression")
        merged = lsx.merge([c1, c2])
        self.assertEqual(list(merged), ["u1"])
        self.assertEqual(merged["u1"]["children"], [])

    def test_union_of_distinct_layers(self):
        c1 = lsx.nodes(lsx_xml(progression("u1")), "Progression")
        c2 = lsx.nodes(lsx_xml(progression("u2")), "Progression")
        self.assertEqual(set(lsx.merge([c1, c2])), {"u1", "u2"})

    def test_missing_uuid_is_an_error(self):
        c = lsx.nodes(lsx_xml(progression(None)), "Progression")
        with self.assertRaisesRegex(ValueError, "Progression"):
            lsx.merge([c])

    def test_duplicate_uuid_in_a_layer_is_an_error(self):
        c = lsx.nodes(lsx_xml(progression("u1") + progression("u1")), "Progression")
        with self.assertRaisesRegex(ValueError, "u1"):
            lsx.merge([c])


if __name__ == "__main__":
    unittest.main()
