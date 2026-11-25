"""Origins (`Origins/Origins.lsx`): the predefined characters, with their class, race, background and
default ability scores (`CharacterCreationPresets/AbilityDistributionPresets.lsx`).

Every reference is resolved to a rules key; one that does not resolve is an error, never a null, unless
`origin_references.txt` gives its rules key. An origin is left out only when listed in `origins_excluded.txt`.
"""
from pathlib import Path

from scripts.data import model

ORIGINS_EXCLUDED = Path(__file__).with_name("origins_excluded.txt")
ORIGIN_REFERENCES = Path(__file__).with_name("origin_references.txt")
ABILITIES = tuple(a for a in model._ABILITIES.values() if a)
# Origin attribute -> (output field, rules section).
_REFERENCES = (("ClassUUID", "class", "classes"), ("SubClassUUID", "subclass", "classes"),
               ("RaceUUID", "race", "races"), ("SubRaceUUID", "subrace", "races"))


def read_excluded(path: Path) -> dict[str, str]:
    """Origins kept out: `<Name>  # reason` per line; Name -> reason."""
    res = {}
    for number, content, reason in model._listed_lines(path):
        if len(content.split()) != 1:
            raise ValueError(f"{path}:{number}: expected a single origin Name before '# reason': {content!r}")
        if content in res:
            raise ValueError(f"{path}:{number}: origin listed twice: {content!r}")
        res[content] = reason
    return res


def read_references(path: Path) -> dict[tuple[str, str], str]:
    """References the game gives as a non-playable element: `<origin> <field> <rules key>  # reason` per line,
    field among class, subclass, race, subrace; (origin, field) -> rules key."""
    fields = {field for _, field, _ in _REFERENCES}
    res = {}
    for number, content, _ in model._listed_lines(path):
        words = content.split()
        if len(words) != 3 or words[1] not in fields:
            raise ValueError(f"{path}:{number}: expected '<origin> <{'|'.join(sorted(fields))}> <rules key>  # reason': "
                             f"{content!r}")
        if (words[0], words[1]) in res:
            raise ValueError(f"{path}:{number}: reference listed twice: {words[0]} {words[1]}")
        res[(words[0], words[1])] = words[2]
    return res


def _presets(presets: dict[str, dict], errors: list[str]) -> dict[str, dict[str, int]]:
    """Ability scores by class or subclass UUID; two presets for one class are an error."""
    res: dict[str, dict[str, int]] = {}
    for uuid, n in presets.items():
        a = n["attributes"]
        class_uuid = a.get("ClassUUID", "")
        if class_uuid in res:
            errors.append(f"ability preset {uuid}: second preset for class {class_uuid}")
            continue
        scores = {}
        for ability in ABILITIES:
            try:
                scores[ability] = int(a.get(ability, ""))
            except ValueError:
                errors.append(f"ability preset {uuid}: invalid {ability}={a.get(ability)!r}")
        res[class_uuid] = scores
    return res


def build(origins: dict[str, dict], presets: dict[str, dict], rules: dict,
          excluded: dict[str, str], references: dict[tuple[str, str], str] | None = None
          ) -> tuple[dict[str, dict], list[str]]:
    """(origins keyed by Name, each with its `text` handles; every error found). `origins` and `presets` are
    the merged LSX nodes by UUID; `rules` holds the classes, races and backgrounds to resolve against;
    `references` (see `read_references`) gives the rules key of a reference that does not resolve: a listed
    reference that resolves by itself, names a missing key or an unknown origin is an error."""
    references = references or {}
    used: set[tuple[str, str]] = set()
    errors: list[str] = []
    scores = _presets(presets, errors)
    keys = {section: {e["uuid"]: name for name, e in rules[section].items()} for section in ("classes", "races")}
    names: dict[str, list[str]] = {}
    for uuid, n in origins.items():
        names.setdefault(n["attributes"].get("Name", ""), []).append(uuid)
    res = {}
    for uuid, n in origins.items():
        a = n["attributes"]
        name = a.get("Name", "")
        if not name:
            errors.append(f"origin {uuid}: missing Name")
            continue
        if len(names[name]) > 1:
            if names[name][0] == uuid:
                errors.append(f"duplicate origin Name {name}: {', '.join(names[name])}")
            continue
        if name in excluded:
            continue
        where = f"origin {name}"
        origin = {}
        for attribute, field, section in _REFERENCES:
            target = model._uuid(a.get(attribute))
            origin[field] = keys[section].get(target) if target else None
            listed = references.get((name, field))
            if listed is not None:
                used.add((name, field))
                if origin[field] is not None or not target:
                    errors.append(f"origin_references.txt: {name} {field} resolves by itself to {origin[field]}; "
                                  "remove it")
                elif listed not in rules[section]:
                    errors.append(f"origin_references.txt: {name} {field}: {listed} is not in rules {section}")
                else:
                    origin[field] = listed
            elif target and origin[field] is None:
                errors.append(f"{where}: {attribute} {target} is not in rules {section}")
        background = model._uuid(a.get("BackgroundUUID"))
        if background and background not in rules["backgrounds"]:
            errors.append(f"{where}: BackgroundUUID {background} is not in rules backgrounds")
        origin["background"] = background
        lock = a.get("LockRace", "")
        if lock not in ("", "true", "false"):
            errors.append(f"{where}: invalid boolean LockRace={lock!r}")
        origin["lockRace"] = lock == "true"
        class_uuid, subclass_uuid = model._uuid(a.get("ClassUUID")), model._uuid(a.get("SubClassUUID"))
        origin["abilities"] = scores.get(subclass_uuid) or scores.get(class_uuid)
        if class_uuid and origin["abilities"] is None:
            errors.append(f"{where}: no ability preset for its class {class_uuid} or subclass {subclass_uuid}")
        origin["text"] = model._text(a)
        res[name] = origin
    errors.extend(f"origin_references.txt: listed reference of an unknown or excluded origin: {o} {f}"
                  for o, f in sorted(set(references) - used))
    errors.extend(f"origins_excluded.txt: listed origin not found: {name}" for name in sorted(set(excluded) - set(names)))
    return dict(sorted(res.items())), errors
