import unittest

from scripts.donnees import lsx


def lsx_xml(corps: str, region: str = "Progressions") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n<save>\n'
        '<version major="4" minor="6" revision="0" build="1"/>\n'
        f'<region id="{region}"><node id="root"><children>{corps}</children></node></region>\n'
        "</save>"
    ).encode("utf-8")


def progression(uuid: str | None, extra: str = "", enfants: str = "") -> str:
    attr_uuid = f'<attribute id="UUID" type="guid" value="{uuid}"/>' if uuid else ""
    bloc = f"<children>{enfants}</children>" if enfants else ""
    return (
        f'<node id="Progression"><attribute id="Name" type="LSString" value="Classe"/>'
        f"{attr_uuid}{extra}{bloc}</node>"
    )


class TestLsx(unittest.TestCase):
    def test_translated_string_donne_le_handle(self):
        xml = lsx_xml(
            '<node id="Race"><attribute id="DisplayName" type="TranslatedString" '
            'handle="h12gabcg" version="1"/></node>'
        )
        [n] = lsx.noeuds(xml, "Race")
        self.assertEqual(n["attributs"]["DisplayName"], "h12gabcg")

    def test_entites_decodees(self):
        xml = lsx_xml(
            '<node id="Feat"><attribute id="Requirements" type="LSString" '
            'value="FeatRequirementAbilityGreaterEqual(&apos;Dexterity&apos;,13)"/></node>'
        )
        [n] = lsx.noeuds(xml, "Feat")
        self.assertEqual(
            n["attributs"]["Requirements"], "FeatRequirementAbilityGreaterEqual('Dexterity',13)"
        )

    def test_enfants(self):
        sous = (
            '<node id="SubClasses"><children>'
            '<node id="SubClass"><attribute id="Object" type="guid" value="aaa"/></node>'
            '<node id="SubClass"><attribute id="Object" type="guid" value="bbb"/></node>'
            "</children></node>"
        )
        [n] = lsx.noeuds(lsx_xml(progression("u1", enfants=sous)), "Progression")
        [conteneur] = n["enfants"]
        self.assertEqual(conteneur["id"], "SubClasses")
        self.assertEqual([e["attributs"]["Object"] for e in conteneur["enfants"]], ["aaa", "bbb"])

    def test_noeuds_filtre_le_type_et_garde_l_ordre(self):
        xml = lsx_xml(progression("u1") + '<node id="Autre"/>' + progression("u2"))
        self.assertEqual([n["attributs"]["UUID"] for n in lsx.noeuds(xml, "Progression")], ["u1", "u2"])

    def test_surcharge_par_uuid(self):
        selecteurs = (
            '<node id="Selectors"><children><node id="S"/></children></node>'
        )
        c1 = lsx.noeuds(lsx_xml(progression("u1", enfants=selecteurs)), "Progression")
        c2 = lsx.noeuds(lsx_xml(progression("u1")), "Progression")
        fusion = lsx.fusionner([c1, c2])
        self.assertEqual(list(fusion), ["u1"])
        self.assertEqual(fusion["u1"]["enfants"], [])

    def test_union_de_couches_distinctes(self):
        c1 = lsx.noeuds(lsx_xml(progression("u1")), "Progression")
        c2 = lsx.noeuds(lsx_xml(progression("u2")), "Progression")
        self.assertEqual(set(lsx.fusionner([c1, c2])), {"u1", "u2"})

    def test_sans_uuid_est_une_erreur(self):
        c = lsx.noeuds(lsx_xml(progression(None)), "Progression")
        with self.assertRaisesRegex(ValueError, "Progression"):
            lsx.fusionner([c])

    def test_uuid_en_double_dans_une_couche_est_une_erreur(self):
        c = lsx.noeuds(lsx_xml(progression("u1") + progression("u1")), "Progression")
        with self.assertRaisesRegex(ValueError, "u1"):
            lsx.fusionner([c])


if __name__ == "__main__":
    unittest.main()
