"""Origins (`Origins/Origins.lsx`): the predefined characters, with their class, race, background and
default ability scores (`CharacterCreationPresets/AbilityDistributionPresets.lsx`).

Every reference is resolved to a rules key; one that does not resolve is an error, never a null, unless
`origin_references.txt` gives its rules key. An origin is left out only when listed in `origins_excluded.txt`.
"""
from pathlib import Path

from scripts.data import model

ORIGINS_EXCLUDED = Path(__file__).with_name("origins_excluded.txt")
ORIGIN_REFERENCES = Path(__file__).with_name("origin_references.txt")
# Rules key of an origin_references.txt entry that drops the reference (the field becomes null).
DROP = "-"
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
    """References the game gives wrongly: `<origin> <field> <rules key | ->  # reason` per line, field among class,
    subclass, race, subrace; `-` (DROP) drops the reference. (origin, field) -> rules key or DROP."""
    fields = {field for _, field, _ in _REFERENCES}
    res = {}
    for number, content, _ in model._listed_lines(path):
        words = content.split()
        if len(words) != 3 or words[1] not in fields:
            raise ValueError(f"{path}:{number}: expected '<origin> <{'|'.join(sorted(fields))}> <rules key|->  # reason': "
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
    `references` (see `read_references`) replaces or drops a reference that does not resolve, or a subclass that is
    not a subclass of the origin's class: a listed reference without such a problem, or whose rules key does not
    fit the origin (a base class, a subclass of its class, a base race, a subrace of its race), is an error, as is
    one of an unknown or excluded origin."""
    references = references or {}
    used: set[tuple[str, str]] = set()
    errors: list[str] = []
    scores = _presets(presets, errors)
    classes = rules["classes"]
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
            value = keys[section].get(target) if target else None
            # The parent a key of this field must have: classes and races are bases, subclasses and subraces
            # belong to the origin's class and race.
            parent = {"class": None, "subclass": origin.get("class"), "race": None, "subrace": origin.get("race")}[field]
            problem = None
            if target and value is None:
                problem = f"{attribute} {target} is not in rules {section}"
            elif field == "subclass" and value is not None and classes[value].get("parent") != parent:
                problem = (f"{attribute} {target} is {value}, a subclass of {classes[value].get('parent')}, "
                           f"not of its class {parent}")
            listed = references.get((name, field))
            if listed is not None:
                used.add((name, field))
                fits = rules[section].get(listed, {}).get("parent", False) == parent
                if not target:
                    errors.append(f"origin_references.txt: {name} has no {field} reference; remove it")
                elif problem is None:
                    errors.append(f"origin_references.txt: {name} {field} resolves by itself to {value}; remove it")
                elif listed == DROP:
                    value = None
                elif listed not in rules[section]:
                    errors.append(f"origin_references.txt: {name} {field}: {listed} is not in rules {section}")
                elif not fits:
                    errors.append(f"origin_references.txt: {name} {field}: {listed} has parent "
                                  f"{rules[section][listed].get('parent')}, expected {parent}")
                else:
                    value = listed
            elif problem is not None:
                errors.append(f"{where}: {problem}")
            origin[field] = value
        background = model._uuid(a.get("BackgroundUUID"))
        if background and background not in rules["backgrounds"]:
            errors.append(f"{where}: BackgroundUUID {background} is not in rules backgrounds")
        origin["background"] = background
        lock = a.get("LockRace", "")
        if lock not in ("", "true", "false"):
            errors.append(f"{where}: invalid boolean LockRace={lock!r}")
        origin["lockRace"] = lock == "true"
        # Whether the character creation screen offers the origin to the player: 1 offered, 2 not (companions and
        # hirelings joining in play).
        creation = a.get("AvailableInCharacterCreation", "")
        if creation not in ("1", "2"):
            errors.append(f"{where}: invalid AvailableInCharacterCreation={creation!r}")
        origin["playable"] = creation == "1"
        # The preset of the resolved (possibly listed) subclass, else of the class.
        class_uuid = classes[origin["class"]]["uuid"] if origin["class"] else None
        subclass_uuid = classes[origin["subclass"]]["uuid"] if origin["subclass"] else None
        origin["abilities"] = scores.get(subclass_uuid) or scores.get(class_uuid)
        if class_uuid and origin["abilities"] is None:
            errors.append(f"{where}: no ability preset for its class {origin['class']} or subclass {origin['subclass']}")
        origin["text"] = model._text(a)
        res[name] = origin
    errors.extend(f"origin_references.txt: listed reference of an unknown or excluded origin: {o} {f}"
                  for o, f in sorted(set(references) - used))
    errors.extend(f"origins_excluded.txt: listed origin not found: {name}" for name in sorted(set(excluded) - set(names)))
    return dict(sorted(res.items())), errors
