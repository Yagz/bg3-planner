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


SCHOOL_LABEL = "hschool"
FRENCH_SCHOOLS = ("Abjuration", "Invocation", "Divination", "Enchantement", "Évocation", "Illusion", "Nécromancie",
                  "Transmutation")


def school_filter(label: str = SCHOOL_LABEL, start: int = 1, end: int = 8) -> str:
    return (f'<ls:EnumFilterItem EnumId="EDamageType" Label="hdamagefilter" AlwaysVisible="False" StartIndex="1" '
            f'EndIndex="13"/>\n<ls:EnumFilterItem EnumId="ESpellSchool" Label="{label}" AlwaysVisible="False" '
            f'StartIndex="{start}" EndIndex="{end}"/>\n')


def school_texts() -> tuple[dict[str, str], dict[str, str]]:
    """English and French texts of the school filter's indexes 1 to 8."""
    return ({f"{SCHOOL_LABEL}_{n}": s for n, s in enumerate(gui.SPELL_SCHOOLS, 1)},
            {f"{SCHOOL_LABEL}_{n}": s for n, s in enumerate(FRENCH_SCHOOLS, 1)})


RARITY_LABEL = "hpopular"
# The popular filters' indexes holding a rarity, with the English and French texts of the game.
RARITY_TEXTS = {128: ("Common", "Commun"), 256: ("Uncommon", "Peu courant"), 512: ("Rare", "Rare"),
                1024: ("Very Rare", "Très rare"), 2048: ("Legendary", "Légendaire")}


def rarity_filter(label: str = RARITY_LABEL) -> str:
    return f'<ls:EnumFilterItem EnumId="ls.EPopularFilters" Label="{label}" AlwaysVisible="True" />\n'


def rarity_texts() -> tuple[dict[str, str], dict[str, str]]:
    """English and French texts of the popular filters: the rarities and a non-rarity index."""
    return ({f"{RARITY_LABEL}_{n}": en for n, (en, _) in RARITY_TEXTS.items()} | {f"{RARITY_LABEL}_1": "Equipment"},
            {f"{RARITY_LABEL}_{n}": fr for n, (_, fr) in RARITY_TEXTS.items()} | {f"{RARITY_LABEL}_1": "Équipement"})


def complete() -> tuple[str, str, str, dict[str, str], dict[str, str]]:
    """Tooltips, sheet and keyboard sheet XAML naming every required id, with English and French tables."""
    tooltips = "".join(skill(s, f"hskill{s}") for s in ui_names.SKILLS)
    tooltips += "".join(colour(d) + damage(d, f"hdamage{d}") for d in gui.DAMAGE_TYPES)
    sheet = "".join(slot(s, f"hslot{s}") for s in gui.PLANNED_SLOTS) + slot("Wings", "hslotWings")
    handles = ([f"hskill{s}" for s in ui_names.SKILLS] + [f"hdamage{d}" for d in gui.DAMAGE_TYPES]
               + [f"hslot{s}" for s in gui.PLANNED_SLOTS])
    school_en, school_fr = school_texts()
    rarity_en, rarity_fr = rarity_texts()
    # The keyboard sheet holds the popular filters twice, with the same label.
    return (tooltips, sheet, rarity_filter() + school_filter() + rarity_filter(),
            {h: f"EN {h}" for h in handles} | school_en | rarity_en,
            {h: f"FR {h}" for h in handles} | school_fr | rarity_fr)


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
        tooltips, sheet, sheet_k, en, fr = complete()
        out_en, out_fr = gui.resolve(tooltips, sheet, sheet_k, en, fr)
        self.assertEqual(out_fr["skill:Persuasion"], {"description": "FR hskillPersuasion"})
        self.assertEqual(out_en["slot:Ring2"], {"name": "EN hslotRing2", "description": None})
        self.assertEqual(out_fr["damage:Fire"], {"name": "FR hdamageFire", "description": None})
        self.assertNotIn("slot:Wings", out_en)
        self.assertEqual(len(out_en), 18 + 16 + 13 + 8 + 5)
        self.assertEqual(set(out_en), set(out_fr))

    def test_missing_and_duplicate_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        tooltips = tooltips.replace(skill("Stealth", "hskillStealth"), "")
        sheet += slot("Helmet", "hOtherHelmet")
        del fr["hdamageCold"]
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        errors = ctx.exception.errors
        self.assertEqual(len(errors), 3, errors)
        self.assertTrue(any("skill:Stealth" in e for e in errors), errors)
        self.assertTrue(any("slot:Helmet" in e and "hOtherHelmet" in e for e in errors), errors)
        self.assertTrue(any("damage:Cold" in e and "hdamageCold" in e and "French" in e for e in errors), errors)

    def test_unreadable_setter_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        sheet = sheet.replace(slot("Boots", "hslotBoots"),
                              trigger("SelectedSlotType", "Boots", '<Setter Property="Text" Value="BOOTS"/>'))
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
        self.assertIn("slot:Boots", ctx.exception.errors[0])

    def test_text_kept_as_the_game_writes_it(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        fr["hslotRangedOffHand"] = "À distance - main secondaire."
        self.assertEqual(gui.resolve(tooltips, sheet, sheet_k, en, fr)[1]["slot:RangedOffHand"]["name"],
                         "À distance - main secondaire.")


    def test_school_names(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        out_en, out_fr = gui.resolve(tooltips, sheet, sheet_k, en, fr)
        self.assertEqual(sorted(k for k in out_en if k.startswith("school:")),
                         sorted(f"school:{s}" for s in gui.SPELL_SCHOOLS))
        self.assertEqual(out_fr["school:Conjuration"], {"name": "Invocation", "description": None})
        self.assertEqual(out_en["school:Evocation"], {"name": "Evocation", "description": None})

    def test_school_index_mismatch_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        en[f"{SCHOOL_LABEL}_2"] = "Abjuration"
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        errors = ctx.exception.errors
        self.assertTrue(any(f"{SCHOOL_LABEL}_2" in e and "Abjuration" in e for e in errors), errors)
        self.assertTrue(any("school:Conjuration" in e for e in errors), errors)

    def test_school_text_not_a_school_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        en[f"{SCHOOL_LABEL}_5"] = "Evokation"
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        errors = ctx.exception.errors
        self.assertTrue(any(f"{SCHOOL_LABEL}_5" in e and "Evokation" in e for e in errors), errors)
        self.assertTrue(any("school:Evocation" in e for e in errors), errors)

    def test_school_index_without_a_handle_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        del fr[f"{SCHOOL_LABEL}_7"]
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        errors = ctx.exception.errors
        self.assertTrue(any(f"{SCHOOL_LABEL}_7" in e and "French" in e for e in errors), errors)
        self.assertTrue(any("school:Necromancy" in e for e in errors), errors)

    def test_school_range_too_short_listed(self):
        tooltips, sheet, _, en, fr = complete()
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, rarity_filter() + school_filter(end=7), en, fr)
        self.assertEqual(ctx.exception.errors, [f"school:Transmutation: found under no index of the ESpellSchool "
                                                f"filter ({SCHOOL_LABEL}_1 to _7) in {gui.GUI_FILES[2]}"])

    def test_school_filter_missing_listed(self):
        tooltips, sheet, _, en, fr = complete()
        for sheet_k in (rarity_filter(), rarity_filter() + school_filter() + school_filter("hother")):
            with self.subTest(count=sheet_k.count("ESpellSchool")):
                with self.assertRaises(texts.MissingText) as ctx:
                    gui.resolve(tooltips, sheet, sheet_k, en, fr)
                self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
                self.assertIn("ESpellSchool", ctx.exception.errors[0])
                self.assertIn(gui.GUI_FILES[2], ctx.exception.errors[0])

    def test_rarity_names(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        out_en, out_fr = gui.resolve(tooltips, sheet, sheet_k, en, fr)
        self.assertEqual(sorted(k for k in out_en if k.startswith("rarity:")),
                         sorted(f"rarity:{r}" for r in gui.RARITIES))
        self.assertEqual(sorted(k for k in out_fr if k.startswith("rarity:")),
                         sorted(f"rarity:{r}" for r in gui.RARITIES))
        self.assertEqual(out_fr["rarity:Uncommon"], {"name": "Peu courant", "description": None})
        self.assertEqual(out_en["rarity:VeryRare"], {"name": "Very Rare", "description": None})
        self.assertEqual(out_fr["rarity:Legendary"], {"name": "Légendaire", "description": None})

    def test_rarity_text_mismatch_listed(self):
        tooltips, sheet, sheet_k, en, fr = complete()
        en[f"{RARITY_LABEL}_1024"] = "VeryRare"
        with self.assertRaises(texts.MissingText) as ctx:
            gui.resolve(tooltips, sheet, sheet_k, en, fr)
        self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
        self.assertIn("rarity:VeryRare", ctx.exception.errors[0])
        self.assertIn(f"{RARITY_LABEL}_1024", ctx.exception.errors[0])
        self.assertIn("'VeryRare'", ctx.exception.errors[0])

    def test_rarity_handle_missing_or_empty_listed(self):
        for language, rarity, index in (("English", "Common", 128), ("French", "Legendary", 2048)):
            for value in (None, " "):
                with self.subTest(language=language, value=value):
                    tooltips, sheet, sheet_k, en, fr = complete()
                    table = en if language == "English" else fr
                    if value is None:
                        del table[f"{RARITY_LABEL}_{index}"]
                    else:
                        table[f"{RARITY_LABEL}_{index}"] = value
                    with self.assertRaises(texts.MissingText) as ctx:
                        gui.resolve(tooltips, sheet, sheet_k, en, fr)
                    self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
                    self.assertIn(f"rarity:{rarity}", ctx.exception.errors[0])
                    self.assertIn(language, ctx.exception.errors[0])

    def test_rarity_filter_missing_or_ambiguous_listed(self):
        tooltips, sheet, _, en, fr = complete()
        for sheet_k in (school_filter(), rarity_filter() + school_filter() + rarity_filter("hother")):
            with self.subTest(count=sheet_k.count("EPopularFilters")):
                with self.assertRaises(texts.MissingText) as ctx:
                    gui.resolve(tooltips, sheet, sheet_k, en, fr)
                self.assertEqual(len(ctx.exception.errors), 1, ctx.exception.errors)
                self.assertIn("EPopularFilters", ctx.exception.errors[0])
                self.assertIn(gui.GUI_FILES[2], ctx.exception.errors[0])


if __name__ == "__main__":
    unittest.main()
