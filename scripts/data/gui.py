"""Skill descriptions, equipment slot names, damage type names, spell school names and item rarity names, which only
the game's interface files link to translation handles.

The interface (XAML) styles hold `<DataTrigger Binding="{Binding <binding>}" Value="<id>">` triggers whose first
setter shows a translated string: `Value="{Binding Source='<handle>', Converter=...}"`. Only the triggers whose first
setter starts with the expected attributes are read (the damage type triggers that set colours are ignored); any
other shape leaves the id without a handle, which is an error, never a guess.

The spell school names come from the character sheet's spell filter instead: `<ls:EnumFilterItem
EnumId="ESpellSchool" Label="<label>" ... StartIndex="<a>" EndIndex="<b>"/>`, whose names are the texts of the
handles `<label>_<n>` for n from a to b. The English text of `<label>_<n>` must be the school id it is filed under
(the spells' `school` values), which is the proof of the mapping.

The item rarity names come from the inventory's popular filters on the same sheet: `<ls:EnumFilterItem
EnumId="ls.EPopularFilters" Label="<label>" .../>` (written twice, with the same label), whose entries are the texts
of the handles `<label>_<n>` for the filter's flag values n; the rarities are the flags 128 to 2048. The English text
of `<label>_<n>` must be the expected English word of the rarity (`Very Rare` for `VeryRare`), which is the proof of
the mapping. The keys are the game's rarity ids, the values of the `{Binding Rarity}` triggers of Tooltips.xaml.
"""
import re

from scripts.data import texts, ui_names

# Paths inside Game.pak (the PC interface). Other platforms' overrides and Mods/MainUI are not read.
GUI_FILES = ("Public/Game/GUI/Library/Tooltips.xaml", "Public/Game/GUI/Library/CharacterSheetTemplates.xaml",
             "Public/Game/GUI/Library/CharacterSheetTemplates_k.xaml")
# Equipment slots of the character sheet the planner uses, in display order (Wings, Horns, Overhead and the light
# source slot are left out).
PLANNED_SLOTS = ("Helmet", "Cloak", "Breast", "Gloves", "Boots", "Amulet", "Ring", "Ring2", "MeleeMainHand",
                 "MeleeOffHand", "RangedMainHand", "RangedOffHand", "MusicalInstrument", "VanityBody", "VanityBoots",
                 "Underwear")
DAMAGE_TYPES = ("Slashing", "Piercing", "Bludgeoning", "Acid", "Thunder", "Necrotic", "Fire", "Lightning", "Cold",
                "Psychic", "Poison", "Radiant", "Force")
# The values of the spells' `school` field.
SPELL_SCHOOLS = ("Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy",
                 "Transmutation")
# The game's item rarity ids -> (flag value of the popular filter, expected English text).
RARITIES = {"Common": (128, "Common"), "Uncommon": (256, "Uncommon"), "Rare": (512, "Rare"),
            "VeryRare": (1024, "Very Rare"), "Legendary": (2048, "Legendary")}
# Placeholder for a trigger whose first setter matches but whose value names no translation handle.
UNREADABLE = "<setter without a translation handle>"

_TRIGGER = re.compile(r'<DataTrigger\s+Binding="\{Binding (\w+)\}"\s+Value="([^"]*)"\s*>(.*?)</DataTrigger>', re.S)
_SETTER = re.compile(r"<Setter\s+([^>]*)")
_HANDLE = re.compile(r"""Value="\{Binding Source='(h\w+)'""")
_SCHOOL_FILTER = re.compile(r'<ls:EnumFilterItem EnumId="ESpellSchool" Label="(h\w+)"[^>]*StartIndex="(\d+)"[^>]*EndIndex="(\d+)"')
_RARITY_FILTER = re.compile(r'<ls:EnumFilterItem EnumId="ls\.EPopularFilters" Label="(h\w+)"')

# (key prefix, file index in GUI_FILES, binding, first setter's leading attributes, expected ids).
_FAMILIES = (("skill", 0, "Skill", 'TargetName="Description"', ui_names.SKILLS),
             ("slot", 1, "SelectedSlotType", 'Property="Text"', PLANNED_SLOTS),
             ("damage", 0, "DamageType", 'TargetName="DamageType" Property="Text"', DAMAGE_TYPES))


def triggers(xaml: str, binding: str, setter: str) -> dict[str, list[str]]:
    """Value -> distinct handles (in file order) of the triggers on `{Binding <binding>}` whose first setter's
    attributes start with `setter` (a regular expression fragment); UNREADABLE stands for such a setter without
    a handle."""
    found: dict[str, list[str]] = {}
    for m in _TRIGGER.finditer(xaml):
        if m[1] != binding:
            continue
        first = _SETTER.search(m[3])
        if first is None or not re.match(setter, first[1]):
            continue
        handle = _HANDLE.search(first[1])
        value = handle[1] if handle else UNREADABLE
        handles = found.setdefault(m[2], [])
        if value not in handles:
            handles.append(value)
    return found


def schools(sheet_k: str, en: dict[str, str], fr: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict], list[str]]:
    """English and French `school:<Id>` -> `{"name", "description": None}` entries of the ESpellSchool filter, and
    the problems: no such filter or more than one, an index whose handle is missing or empty in a table, an English
    text that is not one of SPELL_SCHOOLS, a school found under no index or under several."""
    filters = _SCHOOL_FILTER.findall(sheet_k)
    if len(filters) != 1:
        return {}, {}, [f"expected one EnumFilterItem with EnumId=\"ESpellSchool\" (Label, StartIndex, EndIndex) in "
                        f"{GUI_FILES[2]}, found {len(filters)}"]
    label, start, end = filters[0][0], int(filters[0][1]), int(filters[0][2])
    problems: list[str] = []
    found: dict[str, list[str]] = {}
    for n in range(start, end + 1):
        h = f"{label}_{n}"
        missing = [language for language, table in (("English", en), ("French", fr)) if not texts._present(table, h)]
        if missing:
            problems.append(f"{h}: index {n} of the ESpellSchool filter missing or empty in the "
                            f"{' and '.join(missing)} table")
        elif en[h] not in SPELL_SCHOOLS:
            problems.append(f"{h}: English text {en[h]!r} of the ESpellSchool filter is not a spell school id")
        else:
            found.setdefault(en[h], []).append(h)
    tables: tuple[dict, dict] = ({}, {})
    for school in SPELL_SCHOOLS:
        handles = found.get(school, [])
        if not handles:
            problems.append(f"school:{school}: found under no index of the ESpellSchool filter ({label}_{start} to "
                            f"_{end}) in {GUI_FILES[2]}")
        elif len(handles) > 1:
            problems.append(f"school:{school}: found under several indexes of the ESpellSchool filter: {handles}")
        else:
            for out, table in zip(tables, (en, fr)):
                out[f"school:{school}"] = {"name": table[handles[0]], "description": None}
    return *tables, problems


def rarities(sheet_k: str, en: dict[str, str], fr: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict], list[str]]:
    """English and French `rarity:<Id>` -> `{"name", "description": None}` entries of the ls.EPopularFilters filter,
    and the problems: no such filter or filters with distinct labels, a rarity whose handle is missing or empty in a
    table, an English text that is not the rarity's expected word."""
    labels = sorted(set(_RARITY_FILTER.findall(sheet_k)))
    if len(labels) != 1:
        return {}, {}, [f"expected one label for the EnumFilterItem with EnumId=\"ls.EPopularFilters\" in "
                        f"{GUI_FILES[2]}, found {labels or 'none'}"]
    label = labels[0]
    problems: list[str] = []
    tables: tuple[dict, dict] = ({}, {})
    for rarity, (n, english) in RARITIES.items():
        h = f"{label}_{n}"
        missing = [language for language, table in (("English", en), ("French", fr)) if not texts._present(table, h)]
        if missing:
            problems.append(f"rarity:{rarity}: handle {h} of the ls.EPopularFilters filter missing or empty in the "
                            f"{' and '.join(missing)} table")
        elif en[h] != english:
            problems.append(f"rarity:{rarity}: English text {en[h]!r} of {h} (ls.EPopularFilters filter) is not "
                            f"{english!r}")
        else:
            for out, table in zip(tables, (en, fr)):
                out[f"rarity:{rarity}"] = {"name": table[h], "description": None}
    return *tables, problems


def resolve(tooltips: str, sheet: str, sheet_k: str, en: dict[str, str],
            fr: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """English and French entries: `skill:<Id>` -> `{"description"}` (to merge into the skill names),
    `slot:<Id>`, `damage:<Type>`, `school:<Id>` and `rarity:<Id>` -> `{"name", "description": None}`. Texts are kept
    as the tables write them. Raises texts.MissingText listing every expected id without exactly one handle, every
    handle missing or empty in a table and every problem of the spell school and rarity filters (see `schools` and
    `rarities`)."""
    files = (tooltips, sheet)
    tables: tuple[dict, dict] = ({}, {})
    errors: list[str] = []
    for prefix, file, binding, setter, ids in _FAMILIES:
        found = triggers(files[file], binding, setter)
        for ident in ids:
            key = f"{prefix}:{ident}"
            handles = found.get(ident, [])
            if len(handles) != 1 or handles[0] == UNREADABLE:
                errors.append(f"{key}: expected one translation handle in {GUI_FILES[file]} (trigger on {binding} "
                              f"with a first setter {setter}), found {handles or 'none'}")
                continue
            h = handles[0]
            missing = [language for language, table in (("English", en), ("French", fr)) if not texts._present(table, h)]
            if missing:
                errors.append(f"{key}: handle {h} missing or empty in the {' and '.join(missing)} table")
                continue
            for out, table in zip(tables, (en, fr)):
                out[key] = {"description": table[h]} if prefix == "skill" else {"name": table[h], "description": None}
    school_en, school_fr, school_problems = schools(sheet_k, en, fr)
    errors.extend(school_problems)
    tables[0].update(school_en)
    tables[1].update(school_fr)
    rarity_en, rarity_fr, rarity_problems = rarities(sheet_k, en, fr)
    errors.extend(rarity_problems)
    tables[0].update(rarity_en)
    tables[1].update(rarity_fr)
    if errors:
        raise texts.MissingText(errors)
    return tables
