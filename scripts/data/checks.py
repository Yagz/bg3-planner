"""Checks on the committed game data (`data/larian/`), runnable in CI without the game.

Nothing is corrected: every problem is reported, sorted, one per line.
"""
import json
import sys
from pathlib import Path

from scripts.data import items, model, texts

UNNAMED = Path(__file__).with_name("unnamed.txt")
KNOWN_DUPLICATES = Path(__file__).with_name("known_duplicates.txt")
ITEMS_EXCLUDED = Path(__file__).with_name("items_excluded.txt")

COUNTS = {"base_classes": 12, "subclasses": 58, "races": 39, "base_races": 11, "backgrounds": 22,
          "origin_backgrounds": 11, "feats": 41, "progressions": 663, "lists": 342, "spells": 416, "passives": 475,
          "items": 1167}
# Type of the list each selector function picks from.
SELECTOR_LIST_TYPES = {"AddSpells": "spells", "SelectSpells": "spells", "SelectPassives": "passives",
                       "ReplacePassives": "passives", "SelectSkills": "skills", "SelectSkillsExpertise": "skills",
                       "SelectAbilities": "abilities", "SelectAbilityBonus": "abilities",
                       "SelectEquipment": "equipment"}
# Values of the spell selectors' prepare and cooldown fields observed in the game (patch 8).
PREPARE_VALUES = {None, "AlwaysPrepared"}
COOLDOWN_VALUES = {None, "UntilRest"}

_CATEGORIES = {"classes": "class", "races": "race", "backgrounds": "background", "feats": "feat",
               "spells": "spell", "passives": "passive", "items": "item"}
_LANGUAGES = {"texts.en": "English", "texts.fr": "French"}


def _load(folder: Path, name: str) -> dict:
    return json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))


def _check_texts(rules: dict, tables: dict, unnamed: set[str], descriptionless: set[str]) -> list[str]:
    problems = []
    expected = {f"{category}:{ident}" for section, category in _CATEGORIES.items()
                for ident in rules.get(section, {})}
    idents = expected | {key.split(":", 1)[1] for key in expected}
    for listed in sorted(descriptionless - idents):
        problems.append(f"{listed}: listed with a missing description but not found")
    no_description = {key for key in expected if key in descriptionless or key.split(":", 1)[1] in descriptionless}
    for file, language in _LANGUAGES.items():
        table = tables[file]
        for key in sorted(expected):
            if key in unnamed or key.split(":", 1)[1] in unnamed:
                continue
            entry = table.get(key)
            if entry is None:
                problems.append(f"{key}: no entry in the {language} table")
            elif not (entry.get("name") or "").strip():
                problems.append(f"{key}: empty name in the {language} table")
            elif key in no_description and entry.get("description") is not None:
                problems.append(f"{key}: listed with a missing description but has one in the {language} table")
        for key in sorted(set(table) - expected):
            problems.append(f"{key}: stray key in the {language} table")
    return problems


def _check_references(rules: dict) -> list[str]:
    problems = []
    classes, races = rules.get("classes", {}), rules.get("races", {})
    lists, spells, passives = rules.get("lists", {}), rules.get("spells", {}), rules.get("passives", {})
    tables = {p["table"] for p in rules.get("progressions", [])}

    def passive(where, ident):
        if ident not in passives:
            problems.append(f"{where}: unknown passive {ident}")

    def selectors(where, items):
        for s in items:
            function = s.get("function")
            if s.get("list") is not None and s["list"] not in lists:
                problems.append(f"{where}: unknown list {s['list']}")
            if function not in SELECTOR_LIST_TYPES:
                problems.append(f"{where}: unknown selector function {function}")
            elif s.get("list") in lists and lists[s["list"]].get("type") != SELECTOR_LIST_TYPES[function]:
                problems.append(f"{where}: {function} picks from list {s['list']} of type "
                                f"{lists[s['list']].get('type')}, expected {SELECTOR_LIST_TYPES[function]}")
            if s.get("class") is not None and s["class"] not in classes:
                problems.append(f"{where}: {function} references unknown class {s['class']}")
            if "prepare" in s and s["prepare"] not in PREPARE_VALUES:
                problems.append(f"{where}: {function} has unexpected prepare value {s['prepare']!r}")
            if "cooldown" in s and s["cooldown"] not in COOLDOWN_VALUES:
                problems.append(f"{where}: {function} has unexpected cooldown value {s['cooldown']!r}")

    for section, elements in (("class", classes), ("race", races)):
        for ident, e in elements.items():
            where = f"{section}:{ident}"
            if e.get("table") not in tables:
                problems.append(f"{where}: no progression for table {e.get('table')}")
            if e.get("parent") is not None and e["parent"] not in elements:
                problems.append(f"{where}: unknown parent {e['parent']}")
            if section == "class" and e.get("spell_list") is not None and e["spell_list"] not in lists:
                problems.append(f"{where}: unknown list {e['spell_list']}")
    for p in rules.get("progressions", []):
        where = f"progression:{p.get('uuid', p['table'])}"
        for sub in p.get("subclasses", []):
            if sub not in classes:
                problems.append(f"{where}: unknown subclass {sub}")
        for ident in p.get("passives_added", []) + p.get("passives_removed", []):
            passive(where, ident)
        selectors(where, p.get("selectors", []))
    for ident, f in rules.get("feats", {}).items():
        for p in f.get("passives", []):
            passive(f"feat:{ident}", p)
        selectors(f"feat:{ident}", f.get("selectors", []))
    for ident, b in rules.get("backgrounds", {}).items():
        for p in b.get("passives", []):
            passive(f"background:{ident}", p)
    for ident, lst in lists.items():
        known = {"spells": spells, "passives": passives}.get(lst.get("type"))
        if known is None:
            continue
        for item in lst.get("items", []):
            if item not in known:
                problems.append(f"list:{ident}: unknown {lst['type'][:-1]} {item}")
    return problems


# Wiki kind -> stats type of the item.
_KIND_STATS_TYPES = {"equipment": "Armor", "weapon": "Weapon"}


def _check_items(rules: dict, wiki: dict[str, dict], excluded: dict[str, str]) -> list[str]:
    """The items are exactly the obtainable wiki items that are not excluded, each joined to its wiki entry;
    every exclusion is an obtainable wiki item."""
    expected = set(items.scope(wiki, excluded))
    actual = rules.get("items", {})
    problems = ([f"item:{uid}: obtainable wiki item missing from the items" for uid in sorted(expected - set(actual))]
                + [f"item:{uid}: not an obtainable, non-excluded wiki item" for uid in sorted(set(actual) - expected)]
                + [f"items_excluded.txt: {uid} is not an obtainable wiki item" for uid in sorted(excluded)
                   if uid not in wiki or wiki[uid].get("legacy") is not None])
    for uid, item in sorted(actual.items()):
        w = wiki.get(uid)
        if w is None:
            continue
        if item.get("root_template") != w.get("uuid"):
            problems.append(f"item:{uid}: root_template {item.get('root_template')} differs from the wiki uuid {w.get('uuid')}")
        if item.get("found_by") not in ("stats", "template"):
            problems.append(f"item:{uid}: unexpected found_by {item.get('found_by')!r}")
        if _KIND_STATS_TYPES.get(item.get("kind")) != item.get("stats_type"):
            problems.append(f"item:{uid}: kind {item.get('kind')!r} does not match the stats type {item.get('stats_type')!r}")
        if item.get("kind") != w.get("kind"):
            problems.append(f"item:{uid}: kind {item.get('kind')!r} differs from the wiki kind {w.get('kind')!r}")
    return problems


def _check_counts(rules: dict, counts: dict[str, int]) -> list[str]:
    classes, races = rules.get("classes", {}), rules.get("races", {})
    actual = {
        "base_classes": sum(1 for c in classes.values() if c.get("parent") is None),
        "subclasses": sum(1 for c in classes.values() if c.get("parent") is not None),
        "races": len(races),
        "base_races": sum(1 for r in races.values() if r.get("parent") is None),
        "backgrounds": len(rules.get("backgrounds", {})),
        "origin_backgrounds": sum(1 for b in rules.get("backgrounds", {}).values() if b.get("origin")),
        "feats": len(rules.get("feats", {})),
        "progressions": len(rules.get("progressions", [])),
        "lists": len(rules.get("lists", {})),
        "spells": len(rules.get("spells", {})),
        "passives": len(rules.get("passives", {})),
        "items": len(rules.get("items", {})),
    }
    return [f"count {key}: expected {expected}, found {actual[key]}"
            for key, expected in counts.items() if actual.get(key) != expected]


def _check_meta(meta: dict) -> list[str]:
    problems = []
    if not str(meta.get("game") or "").strip():
        problems.append("meta: no game version")
    for language in ("en", "fr"):
        if not str((meta.get("notice") or {}).get(language) or "").strip():
            problems.append(f"meta: empty notice.{language}")
    return problems


def verify(folder: Path, counts: dict[str, int] = COUNTS, unnamed: set[str] | None = None,
           duplicates: list[frozenset[str]] | None = None, wiki: dict[str, dict] | None = None,
           excluded: dict[str, str] | None = None, descriptionless: set[str] | None = None) -> list[str]:
    """Every problem found in the data folder, sorted; empty when everything is fine. `wiki` (default: the
    committed bg3.wiki items) and `excluded` (default: items_excluded.txt) set the expected items."""
    folder = Path(folder)
    if unnamed is None:
        unnamed = texts.read_unnamed(UNNAMED)
    if descriptionless is None:
        descriptionless = texts.read_unnamed_descriptions(UNNAMED)
    if duplicates is None:
        duplicates = model.read_duplicates(KNOWN_DUPLICATES)
    if wiki is None:
        wiki = items.read_wiki(items.WIKI)
    if excluded is None:
        excluded = model.read_excluded(ITEMS_EXCLUDED)
    rules = _load(folder, "rules")
    tables = {name: _load(folder, name) for name in _LANGUAGES}
    problems = (_check_texts(rules, tables, unnamed, descriptionless) + _check_references(rules)
                + _check_items(rules, wiki, excluded) + _check_counts(rules, counts) + _check_meta(_load(folder, "meta"))
                + model.duplicate_problems(rules.get("progressions", []), duplicates))
    return sorted(problems)


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m scripts.data.checks <data folder>", file=sys.stderr)
        return 2
    problems = verify(Path(argv[1]))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
