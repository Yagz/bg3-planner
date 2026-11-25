"""Checks on the committed game data (`data/larian/`), runnable in CI without the game.

Nothing is corrected: every problem is reported, sorted, one per line.
"""
import json
import sys
from pathlib import Path

from scripts.data import items, model, origins, rulesets, texts, ui_names

UNNAMED = Path(__file__).with_name("unnamed.txt")
KNOWN_DUPLICATES = Path(__file__).with_name("known_duplicates.txt")
ITEMS_EXCLUDED = Path(__file__).with_name("items_excluded.txt")
UNLOCKED_SUBCLASSES = Path(__file__).parents[2] / "data" / "rules" / "unlocked_subclasses.json"
SKILLS = Path(__file__).parents[2] / "data" / "rules" / "skills.json"
TECHNICAL_PASSIVES = model.TECHNICAL_PASSIVES

COUNTS = {"base_classes": 12, "subclasses": 58, "races": 39, "base_races": 11, "backgrounds": 22,
          "origin_backgrounds": 11, "feats": 41, "progressions": 663, "lists": 342, "spells": 416, "passives": 475,
          "items": 1167, "origins": 25, "rulesets": 5}
# Type of the list each selector function picks from.
SELECTOR_LIST_TYPES = {"AddSpells": "spells", "SelectSpells": "spells", "SelectPassives": "passives",
                       "ReplacePassives": "passives", "SelectSkills": "skills", "SelectSkillsExpertise": "skills",
                       "SelectAbilities": "abilities", "SelectAbilityBonus": "abilities",
                       "SelectEquipment": "equipment"}
# Values of the spell selectors' prepare and cooldown fields observed in the game (patch 8).
PREPARE_VALUES = {None, "AlwaysPrepared"}
COOLDOWN_VALUES = {None, "UntilRest"}

_CATEGORIES = {"classes": "class", "races": "race", "backgrounds": "background", "feats": "feat",
               "spells": "spell", "passives": "passive", "items": "item", "origins": "origin",
               "rulesets": "ruleset", "rulesetModifiers": "modifier"}
_LANGUAGES = {"texts.en": "English", "texts.fr": "French"}


def _load(folder: Path, name: str) -> dict:
    return json.loads((folder / f"{name}.json").read_text(encoding="utf-8"))


def skill_ids(rules: dict) -> set[str]:
    """Every item of the rules' skill lists."""
    return {item for lst in rules.get("lists", {}).values() if lst.get("type") == "skills" for item in lst.get("items", [])}


def _check_texts(rules: dict, tables: dict, unnamed: set[str], descriptionless: set[str]) -> list[str]:
    problems = []
    expected = {f"{category}:{ident}" for section, category in _CATEGORIES.items()
                for ident, element in rules.get(section, {}).items()
                if category != "modifier" or element.get("custom") is True}
    expected |= ({f"skill:{ident}" for ident in skill_ids(rules) | set(ui_names.SKILLS)}
                 | {f"ability:{a}" for a in ui_names.ABILITIES} | {key for key, _ in ui_names.LABELS})
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
        # A build modifier the game names without showing it in custom mode may keep its text.
        optional = {f"modifier:{ident}" for ident in rules.get("rulesetModifiers", {})}
        for key in sorted(set(table) - expected - optional):
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


def _check_origins(rules: dict) -> list[str]:
    problems = []
    sections = {"class": "classes", "subclass": "classes", "race": "races", "subrace": "races",
                "background": "backgrounds"}
    for ident, o in sorted(rules.get("origins", {}).items()):
        where = f"origin:{ident}"
        for field, section in sections.items():
            if o.get(field) is not None and o[field] not in rules.get(section, {}):
                problems.append(f"{where}: unknown {field} {o[field]}")
        abilities = o.get("abilities")
        if abilities is not None and (set(abilities) != set(origins.ABILITIES)
                                      or not all(isinstance(v, int) for v in abilities.values())):
            problems.append(f"{where}: abilities must give an integer score for each of the six abilities")
        if o.get("class") is not None and abilities is None:
            problems.append(f"{where}: a class without abilities")
        if not isinstance(o.get("playable"), bool):
            problems.append(f"{where}: playable must be true or false")
    return problems


def _check_rulesets(rules: dict) -> list[str]:
    problems = []
    modifiers = rules.get("rulesetModifiers", {})
    for name in rulesets.BUILD_MODIFIERS:
        if name not in modifiers:
            problems.append(f"rulesetModifiers: build modifier {name} missing")
    for name, m in sorted(modifiers.items()):
        kind = m.get("type")
        if kind not in ("bool", "int"):
            problems.append(f"rulesetModifiers:{name}: type must be bool or int")
            continue
        for field in ("default", "min", "max"):
            if field in m and not _is_kind(m[field], kind):
                problems.append(f"rulesetModifiers:{name}: {field} {m[field]!r} is not a {kind}")
        if not isinstance(m.get("custom"), bool):
            problems.append(f"rulesetModifiers:{name}: custom must be true or false")
    orders = sorted(r.get("order") for r in rules.get("rulesets", {}).values())
    if orders != list(range(len(orders))):
        problems.append(f"rulesets: order must be 0..{len(orders) - 1} without gaps or duplicates, found {orders}")
    for ident, r in sorted(rules.get("rulesets", {}).items()):
        for name, value in sorted(r.get("values", {}).items()):
            where = f"ruleset:{ident}: {name}"
            m = modifiers.get(name)
            if m is None:
                problems.append(f"{where}: not a known build modifier")
            elif m.get("type") in ("bool", "int") and not _is_kind(value, m["type"]):
                problems.append(f"{where}: {value!r} is not a {m['type']}")
            elif m.get("type") == "int" and not (m.get("min", value) <= value <= m.get("max", value)):
                problems.append(f"{where}: {value} is outside {m.get('min')}..{m.get('max')}")
    return problems


def _is_kind(value, kind: str) -> bool:
    return isinstance(value, bool) if kind == "bool" else isinstance(value, int) and not isinstance(value, bool)


def read_skills(path: Path) -> dict[str, str]:
    """Hand-written skill-to-ability map: `{skill: ability}`."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def check_skills(rules: dict, skills: dict[str, str]) -> list[str]:
    """The map's keys are exactly the items of the rules' skill lists, each mapped to one of the six abilities."""
    actual = skill_ids(rules)
    return ([f"skills.json: skill missing from the map: {s}" for s in sorted(actual - set(skills))]
            + [f"skills.json: not an item of any skill list: {s}" for s in sorted(set(skills) - actual)]
            + [f"skills.json: {s} maps to {a!r}, not an ability" for s, a in sorted(skills.items())
               if a not in origins.ABILITIES])


def check_technical(rules: dict, technical: dict[str, str]) -> list[str]:
    """Exactly the passives listed in technical_passives.txt are marked `technical: true`."""
    passives = rules.get("passives", {})
    marked = {name for name, p in passives.items() if p.get("technical") is True}
    return ([f"technical_passives.txt: listed passive not in the rules: {name}" for name in sorted(set(technical) - set(passives))]
            + [f"passive:{name}: listed in technical_passives.txt but not marked technical"
               for name in sorted((set(technical) & set(passives)) - marked)]
            + [f"passive:{name}: marked technical but not listed in technical_passives.txt"
               for name in sorted(marked - set(technical))])


def technical_candidates(rules: dict, tables: dict, technical: dict[str, str]) -> list[str]:
    """Report lines of the passives not yet listed as technical whose name, in either language, is missing,
    empty or starts with a lowercase letter, grouped by that reason."""
    groups: dict[str, list[str]] = {"no name in either table": [], "name in one table only": [],
                                    "name starting with a lowercase letter": []}
    for name in sorted(set(rules.get("passives", {})) - set(technical)):
        names = [((tables[file].get(f"passive:{name}") or {}).get("name") or "").strip() for file in _LANGUAGES]
        if not any(names):
            groups["no name in either table"].append(name)
        elif not all(names):
            groups["name in one table only"].append(name)
        elif any(n[:1].islower() for n in names):
            groups["name starting with a lowercase letter"].append(f"{name}  ({' / '.join(names)})")
    count = sum(len(v) for v in groups.values())
    lines = [f"{count} candidate technical passive(s), not yet in technical_passives.txt"]
    for reason, entries in groups.items():
        if entries:
            lines.append(f"{reason} ({len(entries)}):")
            lines.extend(f"  {entry}" for entry in entries)
    return lines


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
        "origins": len(rules.get("origins", {})),
        "rulesets": len(rules.get("rulesets", {})),
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


def read_unlocked(path: Path) -> dict[str, dict]:
    """Hand-written subclasses unlocked during play: `{subclass: {"parent", "reason", "source"}}`."""
    return json.loads(Path(path).read_text(encoding="utf-8"))


def check_unlocked(rules: dict, unlocked: dict[str, dict]) -> list[str]:
    """Each subclass unlocked in play is a subclass of its parent, with a reason and a source, and offered by no
    progression row: once a row offers it, the entry is stale."""
    problems = []
    classes = rules.get("classes", {})
    offered = {name for p in rules.get("progressions", []) for name in p.get("subclasses") or []}
    for name, entry in unlocked.items():
        where = f"unlocked_subclasses.json: {name}"
        parent = entry.get("parent")
        if name not in classes:
            problems.append(f"{where}: not a class in rules.json")
        elif not parent or classes[name].get("parent") != parent:
            problems.append(f"{where}: parent {parent!r} is not its class parent {classes[name].get('parent')!r}")
        for field in ("reason", "source"):
            if not str(entry.get(field) or "").strip():
                problems.append(f"{where}: empty {field}")
        if name in offered:
            problems.append(f"{where}: offered by a progression row, the entry is stale")
    return problems


def verify(folder: Path, counts: dict[str, int] = COUNTS, unnamed: set[str] | None = None,
           duplicates: list[frozenset[str]] | None = None, wiki: dict[str, dict] | None = None,
           excluded: dict[str, str] | None = None, descriptionless: set[str] | None = None,
           unlocked: dict[str, dict] | None = None, skills: dict[str, str] | None = None,
           technical: dict[str, str] | None = None) -> list[str]:
    """Every problem found in the data folder, sorted; empty when everything is fine. `wiki` (default: the
    committed bg3.wiki items) and `excluded` (default: items_excluded.txt) set the expected items; `unlocked`
    (default: data/rules/unlocked_subclasses.json) the subclasses unlocked in play; `skills` (default:
    data/rules/skills.json) the skill-to-ability map; `technical` (default: technical_passives.txt) the passives
    marked technical."""
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
    if unlocked is None:
        unlocked = read_unlocked(UNLOCKED_SUBCLASSES)
    if skills is None:
        skills = read_skills(SKILLS)
    if technical is None:
        technical = model.read_technical(TECHNICAL_PASSIVES)
    rules = _load(folder, "rules")
    tables = {name: _load(folder, name) for name in _LANGUAGES}
    problems = (_check_texts(rules, tables, unnamed, descriptionless) + _check_references(rules)
                + _check_items(rules, wiki, excluded) + _check_counts(rules, counts) + _check_meta(_load(folder, "meta"))
                + model.duplicate_problems(rules.get("progressions", []), duplicates) + check_unlocked(rules, unlocked)
                + _check_origins(rules) + _check_rulesets(rules) + check_skills(rules, skills) + check_technical(rules, technical))
    return sorted(problems)


def main(argv: list[str]) -> int:
    if len(argv) == 3 and argv[2] == "--technical-candidates":
        folder = Path(argv[1])
        lines = technical_candidates(_load(folder, "rules"), {name: _load(folder, name) for name in _LANGUAGES},
                                     model.read_technical(TECHNICAL_PASSIVES))
        print("\n".join(lines))
        return 0
    if len(argv) != 2:
        print("usage: python -m scripts.data.checks <data folder> [--technical-candidates]", file=sys.stderr)
        return 2
    problems = verify(Path(argv[1]))
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
