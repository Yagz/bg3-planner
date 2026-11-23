"""Resolving the English and French names and descriptions of every rules element.

Texts are kept raw (markup and `[1]` parameters included); rendering is the UI's job. A missing
text is never replaced: the resolution fails once, with the complete list.
"""
import copy
from pathlib import Path

# Rules category -> text table category.
_CATEGORIES = {"classes": "class", "races": "race", "backgrounds": "background", "feats": "feat",
               "spells": "spell", "passives": "passive"}


class MissingText(Exception):
    """Elements without a name, or whose handles are absent from a table; `errors` lists every case."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def read_unnamed(path: Path) -> set[str]:
    """Identifiers, one per line; everything after `#` and blank lines are ignored."""
    res = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            res.add(line)
    return res


def resolve(rules: dict, en: dict[str, str], fr: dict[str, str],
            unnamed: set[str]) -> tuple[dict, dict[str, dict], dict[str, dict]]:
    """Rules without their `text` fields, plus the English and French `{"<category>:<id>": {...}}` tables."""
    out = copy.deepcopy(rules)
    tables: tuple[dict, dict] = ({}, {})
    errors: list[str] = []
    for section, category in _CATEGORIES.items():
        for ident, element in sorted(out.get(section, {}).items()):
            text = element.pop("text")
            key = f"{category}:{ident}"
            if key in unnamed or ident in unnamed:
                continue
            name, description = text["name"], text["description"]
            if name is None:
                errors.append(f"{key}: no name handle")
                continue
            entries = []
            for language, table, result in (("English", en, tables[0]), ("French", fr, tables[1])):
                missing = False
                for kind, h in (("name", name), ("description", description)):
                    if h is not None and not table.get(h, "").strip():
                        errors.append(f"{key}: {kind} handle {h} missing or empty in the {language} table")
                        missing = True
                if not missing:
                    entries.append((result, {"name": table[name], "description":
                                             table[description] if description is not None else None}))
            if len(entries) == 2:
                for result, entry in entries:
                    result[key] = entry
    if errors:
        raise MissingText(errors)
    return out, tables[0], tables[1]
