"""Names of the skills and abilities, which no data file links to a translation handle.

The translation tables hold them as two indexed families of entries (`<handle>_<index>`) in the engine's
enum order. Each entry's English text must equal the label derived from its identifier (`SleightOfHand` ->
`Sleight of Hand`, compared case-insensitively), so the order assumption is checked on every import.
"""
import re

from scripts.data import texts

SKILL_HANDLE = "h65e11968gf9b6g4c47g9efcg03fb60fb923c"
ABILITY_HANDLE = "h6c83537fg6358g41e0g8a18g32cc8316ced2"
# The engine's Skill enum order: entry `<SKILL_HANDLE>_<i>` names SKILLS[i].
SKILLS = ("Deception", "Intimidation", "Performance", "Persuasion", "Acrobatics", "SleightOfHand", "Stealth",
          "Arcana", "History", "Investigation", "Nature", "Religion", "Athletics", "AnimalHandling", "Insight",
          "Medicine", "Perception", "Survival")
# The engine's Ability enum order, from 1 (0 is "None"): entry `<ABILITY_HANDLE>_<i>` names ABILITIES[i - 1].
ABILITIES = ("Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma")
# Words written in lower case inside a label.
_MINOR_WORDS = {"Of", "And", "The"}


def label(ident: str) -> str:
    """English label of a CamelCase identifier: words split, minor words after the first in lower case."""
    words = re.findall(r"[A-Z][a-z]*|[a-z]+|\d+", ident)
    return " ".join(w.lower() if i and w in _MINOR_WORDS else w for i, w in enumerate(words))


def _entries() -> list[tuple[str, str]]:
    """(`<kind>:<Id>`, handle) of every skill and ability."""
    return ([(f"skill:{s}", f"{SKILL_HANDLE}_{i}") for i, s in enumerate(SKILLS)]
            + [(f"ability:{a}", f"{ABILITY_HANDLE}_{i}") for i, a in enumerate(ABILITIES, 1)])


def resolve(en: dict[str, str], fr: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """English and French `{"<kind>:<Id>": {"name", "description": None}}` for the 18 skills and six abilities;
    raises texts.MissingText with every missing entry and every English text that does not match its id."""
    tables: tuple[dict, dict] = ({}, {})
    errors: list[str] = []
    for key, h in _entries():
        missing = [language for language, table in (("English", en), ("French", fr)) if not texts._present(table, h)]
        if missing:
            errors.append(f"{key}: handle {h} missing or empty in the {' and '.join(missing)} table")
            continue
        expected = label(key.split(":", 1)[1])
        if en[h].casefold() != expected.casefold():
            errors.append(f"{key}: handle {h} reads {en[h]!r} in English, expected {expected!r}: "
                          "the family's order changed")
            continue
        tables[0][key] = {"name": en[h], "description": None}
        tables[1][key] = {"name": fr[h], "description": None}
    if errors:
        raise texts.MissingText(errors)
    return tables
