import unittest

from scripts.data import gui, texts, ui_names


def trigger(binding: str, value: str, setter: str) -> str:
    return f'<DataTrigger Binding="{{Binding {binding}}}" Value="{value}">\n    {setter}\n</DataTrigger>\n'


def skill(value: str, handle: str) -> str:
    return trigger("Skill", value,
                   f'<Setter TargetName="Description" Property="ls:TextBlockFormatter.SourceText" '
                   f'Value="{{Binding Source=\'{handle}\', Converter={{StaticResource TranslatedStringConverter}}}}"/>\n'
                   f'    <Setter TargetName="SkillValue" Property="ls:TextBlockFormatter.SourceText">\n'
                   f'        <Setter.Value>x</Setter.Value>\n    </Setter>')


def damage(value: str, handle: str) -> str:
    return trigger("DamageType", value,
                   f'<Setter TargetName="DamageType" Property="Text" '
                   f'Value="{{Binding Source=\'{handle}\',Converter={{StaticResource TranslatedStringConverter}}}}"/>')


def colour(value: str) -> str:
    return trigger("DamageType", value, f'<Setter Property="Foreground" Value="{{StaticResource DamageType.{value}}}" />')


def slot(value: str, handle: str) -> str:
    return trigger("SelectedSlotType", value,
                   f'<Setter Property="Text" Value="{{Binding Source=\'{handle}\',Converter={{StaticResource '
                   f'TranslatedStringConverter}}, ConverterParameter=\'ToUpper\'}}"/>')


def complete() -> tuple[str, str, dict[str, str], dict[str, str]]:
    """Tooltips and sheet XAML naming every required id, with English and French tables."""
    tooltips = "".join(skill(s, f"hskill{s}") for s in ui_names.SKILLS)
    tooltips += "".join(colour(d) + damage(d, f"hdamage{d}") for d in gui.DAMAGE_TYPES)
    sheet = "".join(slot(s, f"hslot{s}") for s in gui.PLANNED_SLOTS) + slot("Wings", "hslotWings")
    handles = ([f"hskill{s}" for s in ui_names.SKILLS] + [f"hdamage{d}" for d in gui.DAMAGE_TYPES]
               + [f"hslot{s}" for s in gui.PLANNED_SLOTS])
    return tooltips, sheet, {h: f"EN {h}" for h in handles}, {h: f"FR {h}" for h in handles}


class TriggersTest(unittest.TestCase):
    def test_skill_descriptions(self):
        xaml = skill("Acrobatics", "hAcro") + skill("Persuasion", "hPers")
        self.assertEqual(gui.triggers(xaml, "Skill", 'TargetName="Description"'),
                         {"Acrobatics": ["hAcro"], "Persuasion": ["hPers"]})

    def test_damage_names_ignore_colour_setters(self):
        xaml = colour("Acid") + damage("Acid", "hAcid")
        self.assertEqual(gui.triggers(xaml, "DamageType", 'TargetName="DamageType" Property="Text"'),
                         {"Acid": ["hAcid"]})

    def test_slot_names(self):
        xaml = slot("Helmet", "hHelmet") + slot("Ring2", "hRing2")
        self.assertEqual(gui.triggers(xaml, "SelectedSlotType", 'Property="Text"'),
                         {"Helmet": ["hHelmet"], "Ring2": ["hRing2"]})

    def test_setter_fragment_anchored_at_the_attributes(self):
        # `Property="Text"` must not match a setter that starts with another attribute.
        xaml = damage("Acid", "hAcid")
        self.assertEqual(gui.triggers(xaml, "DamageType", 'Property="Text"'), {})

    def test_same_handle_twice_counts_once(self):
        xaml = slot("Helmet", "hHelmet") + slot("Helmet", "hHelmet")
        self.assertEqual(gui.triggers(xaml, "SelectedSlotType", 'Property="Text"'), {"Helmet": ["hHelmet"]})

    def test_matching_setter_without_a_handle_is_kept_as_unreadable(self):
        xaml = trigger("SelectedSlotType", "Helmet", '<Setter Property="Text" Value="HELMET"/>')
        self.assertEqual(gui.triggers(xaml, "SelectedSlotType", 'Property="Text"'), {"Helmet": [gui.UNREADABLE]})


class ResolveTest(unittest.TestCase):
    def test_entries(self):
        tooltips, sheet, en, fr = complete()
        out_en, out_fr = gui.resolve(tooltips, sheet, en, fr)
        self.assertEqual(out_fr["skill:Persuasion"], {"description": "FR hskillPersuasion"})
        self.assertEqual(out_en["slot:Ring2"], {"name": "EN hslotRing2", "description": None})
        self.assertEqual(out_fr["damage:Fire"], {"name": "FR hdamageFire", "description": None})
        self.assertNotIn("slot:Wings", out_en)
        self.assertEqual(len(out_en), 18 + 16 + 13)
        self.assertEqual(set(out_en), set(out_fr))

    def test_missing_and_duplicate_listed(self):
        tooltips, sheet, en, fr = complete()
        tooltips = tooltips.replace(skill("Stealth", "hskillStealth"), "")
        sheet += slot("Helmet", "hOtherHelmet")
        del fr["hdamageCold"]
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, en, fr)
        errors = ctx.exception.errors
        self.assertEqual(len(errors), 3, errors)
        self.assertTrue(any("skill:Stealth" in e for e in errors), errors)
        self.assertTrue(any("slot:Helmet" in e and "hOtherHelmet" in e for e in errors), errors)
        self.assertTrue(any("damage:Cold" in e and "hdamageCold" in e and "French" in e for e in errors), errors)

    def test_unreadable_setter_listed(self):
        tooltips, sheet, en, fr = complete()
        sheet = sheet.replace(slot("Boots", "hslotBoots"),
                              trigger("SelectedSlotType", "Boots", '<Setter Property="Text" Value="BOOTS"/>'))
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, en, fr)
        self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
        self.assertIn("slot:Boots", ctx.exception.errors[0])

    def test_text_kept_as_the_game_writes_it(self):
        tooltips, sheet, en, fr = complete()
        fr["hslotRangedOffHand"] = "À distance - main secondaire."
        self.assertEqual(gui.resolve(tooltips, sheet, en, fr)[1]["slot:RangedOffHand"]["name"],
                         "À distance - main secondaire.")


if __name__ == "__main__":
    unittest.main()
