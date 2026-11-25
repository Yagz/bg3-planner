"""Names of the skills and abilities, which no data file links to a translation handle.

The English label is derived from the identifier (`SleightOfHand` -> `Sleight of Hand`); the translation
entries whose English text equals it exactly must all give the same French text. An identifier with no
match, or with several French texts, is an error unless `ui_names.txt` names its handle.
"""
import re
from pathlib import Path

from scripts.data import model, texts

UI_NAMES = Path(__file__).with_name("ui_names.txt")
KINDS = ("skill", "ability")
# Words written in lower case inside a label.
_MINOR_WORDS = {"Of", "And", "The"}


def label(ident: str) -> str:
    """English label of a CamelCase identifier: words split, minor words after the first in lower case."""
    words = re.findall(r"[A-Z][a-z]*|[a-z]+|\d+", ident)
    return " ".join(w.lower() if i and w in _MINOR_WORDS else w for i, w in enumerate(words))


def read_listed(path: Path) -> dict[str, str]:
    """`<kind>:<Id> <handle>  # reason` per line; `<kind>:<Id>` -> handle."""
    res = {}
    for number, content, _ in model._listed_lines(path):
        words = content.split()
        kind = words[0].split(":", 1)[0] if words else ""
        if len(words) != 2 or ":" not in words[0] or kind not in KINDS:
            raise ValueError(f"{path}:{number}: expected '<{'|'.join(KINDS)}>:<Id> <handle>  # reason': {content!r}")
        if words[0] in res:
            raise ValueError(f"{path}:{number}: identifier listed twice: {words[0]!r}")
        res[words[0]] = words[1]
    return res


def resolve(ids: dict[str, list[str]], en: dict[str, str], fr: dict[str, str],
            listed: dict[str, str]) -> tuple[dict[str, dict], dict[str, dict]]:
    """English and French `{"<kind>:<Id>": {"name", "description": None}}` for the identifiers of each kind;
    raises texts.MissingText with every unresolved identifier and every listed entry that is not exact."""
    by_text: dict[str, list[str]] = {}
    for h, text in en.items():
        by_text.setdefault(text, []).append(h)
    tables: tuple[dict, dict] = ({}, {})
    errors: list[str] = []
    keys = {f"{kind}:{ident}" for kind, idents in ids.items() for ident in idents}
    for key in sorted(keys):
        english = label(key.split(":", 1)[1])
        matches = sorted(h for h in by_text.get(english, []) if texts._present(en, h) and texts._present(fr, h))
        french = sorted({fr[h] for h in matches})
        if key in listed:
            h = listed[key]
            if len(french) == 1:
                errors.append(f"ui_names.txt: {key} resolves to a single French text {french[0]!r}; remove it")
            elif not (texts._present(en, h) and texts._present(fr, h)):
                errors.append(f"ui_names.txt: {key}: handle {h} missing or empty in a translation table")
            else:
                tables[0][key] = {"name": en[h], "description": None}
                tables[1][key] = {"name": fr[h], "description": None}
            continue
        if not matches:
            errors.append(f"{key}: no translation entry whose English text is {english!r} in both tables")
        elif len(french) > 1:
            candidates = ", ".join(f"{h} => {fr[h]!r}" for h in matches)
            errors.append(f"{key}: English text {english!r} has several French texts: {candidates}")
        else:
            tables[0][key] = {"name": english, "description": None}
            tables[1][key] = {"name": french[0], "description": None}
    errors.extend(f"ui_names.txt: listed identifier not found: {key}" for key in sorted(set(listed) - keys))
    if errors:
        raise texts.MissingText(errors)
    return tables
