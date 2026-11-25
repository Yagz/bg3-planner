"""Resolving the English and French names and descriptions of every rules element.

Texts are kept raw (markup and `[1]` parameters included); rendering is the UI's job. A missing
text is never replaced: the resolution fails once, with the complete list.
"""
import copy
from pathlib import Path

# Rules category -> text table category.
_CATEGORIES = {"classes": "class", "races": "race", "backgrounds": "background", "feats": "feat",
               "spells": "spell", "passives": "passive", "items": "item", "origins": "origin",
               "rulesets": "ruleset", "rulesetModifiers": "modifier"}

# The game's marker for an unknown translation handle: as a handle or as a text, it counts as missing.
UNKNOWN_HANDLE = "ls::TranslatedStringRepository::s_HandleUnknown"


def _present(table: dict[str, str], h: str) -> bool:
    text = table.get(h, "")
    return h != UNKNOWN_HANDLE and bool(text.strip()) and text != UNKNOWN_HANDLE


class MissingText(Exception):
    """Elements without a name, or whose handles are absent from a table; `errors` lists every case."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def _unnamed_lines(path: Path) -> tuple[set[str], set[str]]:
    """(whole-element entries, description-only entries) of an unnamed list."""
    whole, descriptions = set(), set()
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        words = line.split("#", 1)[0].split()
        if not words:
            continue
        if len(words) > 2 or (len(words) == 2 and words[1] != "description"):
            raise ValueError(f"{path}:{number}: expected '<identifier>' or '<identifier> description': {line!r}")
        ident = words[0]
        if ident in whole or ident in descriptions:
            raise ValueError(f"{path}:{number}: identifier listed twice: {ident!r}")
        (descriptions if len(words) == 2 else whole).add(ident)
    return whole, descriptions


def read_unnamed(path: Path) -> set[str]:
    """Identifiers left without any text, one per line; everything after `#` and blank lines are ignored."""
    return _unnamed_lines(path)[0]


def read_unnamed_descriptions(path: Path) -> set[str]:
    """Identifiers listed as `<identifier> description`: the name is kept, the description knowingly missing."""
    return _unnamed_lines(path)[1]


def _entries(key: str, text: dict, en: dict[str, str], fr: dict[str, str]) -> tuple[list[tuple[dict, dict]], list[str]]:
    """The English and French entries of one element, or the errors that prevent them."""
    name, description = text["name"], text["description"]
    if name is None:
        return [], [f"{key}: no name handle"]
    entries, errors = [], []
    for language, table in (("English", en), ("French", fr)):
        missing = False
        for kind, h in (("name", name), ("description", description)):
            if h is not None and not _present(table, h):
                errors.append(f"{key}: {kind} handle {h} missing or empty in the {language} table")
                missing = True
        if not missing:
            entries.append({"name": table[name], "description": table[description] if description is not None else None})
    return entries, errors


def resolve(rules: dict, en: dict[str, str], fr: dict[str, str], unnamed: set[str],
            descriptionless: set[str] = frozenset()) -> tuple[dict, dict[str, dict], dict[str, dict]]:
    """Rules without their `text` fields, plus the English and French `{"<category>:<id>": {...}}` tables.

    An element listed in `unnamed` gets no text. An element listed in `descriptionless` keeps its name,
    which must exist in both languages, with a null description in both tables. A listed identifier that
    matches no element, or whose element lacks nothing the listing excuses, is an error: the lists must
    stay exact.
    """
    out = copy.deepcopy(rules)
    tables: tuple[dict, dict] = ({}, {})
    errors: list[str] = []
    matched: set[str] = set()
    for section, category in _CATEGORIES.items():
        for ident, element in sorted(out.get(section, {}).items()):
            text = element.pop("text", None)
            if text is None and category == "modifier":
                continue  # the game names only some modifiers; a modifier without handles has no text
            key = f"{category}:{ident}"
            entries, problems = _entries(key, text, en, fr)
            listed = {key, ident} & descriptionless
            if listed:
                matched |= listed
                name_entries, name_problems = _entries(key, {**text, "description": None}, en, fr)
                errors.extend(name_problems)
                if text["description"] is None:
                    errors.append(f"{key}: listed with a missing description but has no description handle; "
                                  "remove it")
                elif not problems:
                    errors.append(f"{key}: listed with a missing description but has it in both languages; "
                                  "remove it")
                if not name_problems:
                    for result, entry in zip(tables, name_entries):
                        result[key] = entry
                continue
            listed = {key, ident} & unnamed
            if listed:
                matched |= listed
                if not problems:
                    errors.append(f"{key}: listed as unnamed but has texts in both languages; remove it")
                continue
            errors.extend(problems)
            if not problems:
                for result, entry in zip(tables, entries):
                    result[key] = entry
    errors.extend(f"{ident}: listed as unnamed but not found" for ident in sorted(unnamed - matched))
    errors.extend(f"{ident}: listed with a missing description but not found"
                  for ident in sorted(descriptionless - matched))
    if errors:
        raise MissingText(errors)
    return out, tables[0], tables[1]
