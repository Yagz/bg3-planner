"""Skill descriptions, equipment slot names and damage type names, which only the game's interface files link to
translation handles.

The interface (XAML) styles hold `<DataTrigger Binding="{Binding <binding>}" Value="<id>">` triggers whose first
setter shows a translated string: `Value="{Binding Source='<handle>', Converter=...}"`. Only the triggers whose first
setter starts with the expected attributes are read (the damage type triggers that set colours are ignored); any
other shape leaves the id without a handle, which is an error, never a guess.
"""
import re

from scripts.data import texts, ui_names

# Paths inside Game.pak (the PC interface). Other platforms' overrides and Mods/MainUI are not read.
GUI_FILES = ("Public/Game/GUI/Library/Tooltips.xaml", "Public/Game/GUI/Library/CharacterSheetTemplates.xaml")
# Equipment slots of the character sheet the planner uses, in display order (Wings, Horns, Overhead and the light
# source slot are left out).
PLANNED_SLOTS = ("Helmet", "Cloak", "Breast", "Gloves", "Boots", "Amulet", "Ring", "Ring2", "MeleeMainHand",
                 "MeleeOffHand", "RangedMainHand", "RangedOffHand", "MusicalInstrument", "VanityBody", "VanityBoots",
                 "Underwear")
DAMAGE_TYPES = ("Slashing", "Piercing", "Bludgeoning", "Acid", "Thunder", "Necrotic", "Fire", "Lightning", "Cold",
                "Psychic", "Poison", "Radiant", "Force")
# Placeholder for a trigger whose first setter matches but whose value names no translation handle.
UNREADABLE = "<setter without a translation handle>"

_TRIGGER = re.compile(r'<DataTrigger\s+Binding="\{Binding (\w+)\}"\s+Value="([^"]*)"\s*>(.*?)</DataTrigger>', re.S)
_SETTER = re.compile(r"<Setter\s+([^>]*)")
_HANDLE = re.compile(r"""Value="\{Binding Source='(h\w+)'""")

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


def resolve(tooltips: str, sheet: str, en: dict[str, str], fr: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """English and French entries: `skill:<Id>` -> `{"description"}` (to merge into the skill names),
    `slot:<Id>` and `damage:<Type>` -> `{"name", "description": None}`. Texts are kept as the tables write them.
    Raises texts.MissingText listing every expected id without exactly one handle and every handle missing or
    empty in a table."""
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
    if errors:
        raise texts.MissingText(errors)
    return tables
