"""Building the character-creation and progression rules from the parsed game files.

Every defect (duplicate identifier, orphan reference, unreadable value) is collected; the build
fails once, with the complete list.
"""
from scripts.data import selectors

NULL_UUID = "00000000-0000-0000-0000-000000000000"

_ABILITIES = {0: None, 1: "Strength", 2: "Dexterity", 3: "Constitution", 4: "Intelligence", 5: "Wisdom",
              6: "Charisma"}
_PROGRESSION_TYPES = {"0": "class", "1": "subclass", "2": "race"}
# Source file -> (list type, items attribute, separator), as observed in the game files.
_LIST_FILES = {
    "SpellLists": ("spells", "Spells", ";"),
    "PassiveLists": ("passives", "Passives", ","),
    "SkillLists": ("skills", "Skills", ","),
    "AbilityLists": ("abilities", "Abilities", ","),
    "EquipmentLists": ("equipment", "Items", ";"),
}


class ModelError(Exception):
    """Duplicate identifiers, orphan references or unreadable values; `errors` carries every case."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def handle(value: str | None) -> str | None:
    """Translation handle without its version suffix (`"h1;3"` -> `"h1"`); empty -> None."""
    if not value:
        return None
    return value.split(";", 1)[0] or None


def _text(attributes: dict) -> dict:
    return {"name": handle(attributes.get("DisplayName")), "description": handle(attributes.get("Description"))}


def _uuid(value: str | None) -> str | None:
    """Absent, empty or null UUID -> None."""
    return None if not value or value == NULL_UUID else value


def _split(value: str | None, separator: str = ";") -> list[str]:
    return [v.strip() for v in (value or "").split(separator) if v.strip()]


class _Builder:
    def __init__(self, lsx_by_file: dict, presets: dict, stats: dict):
        self.lsx = lsx_by_file
        self.presets = presets
        self.stats = stats
        self.errors: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def read_bool(self, attributes: dict, key: str, where: str) -> bool:
        value = attributes.get(key, "")
        if value in ("", "false"):
            return False
        if value == "true":
            return True
        self.error(f"{where}: invalid boolean {key}={value!r}")
        return False

    def read_int(self, attributes: dict, key: str, where: str, required: bool = False) -> int | None:
        value = attributes.get(key, "")
        if value == "":
            if required:
                self.error(f"{where}: missing {key}")
            return None
        try:
            return int(value)
        except ValueError:
            self.error(f"{where}: invalid integer {key}={value!r}")
            return None

    def read_float(self, attributes: dict, key: str, where: str) -> float | None:
        value = attributes.get(key, "")
        if value == "":
            return None
        try:
            return float(value)
        except ValueError:
            self.error(f"{where}: invalid number {key}={value!r}")
            return None

    def ability(self, attributes: dict, key: str, where: str) -> str | None:
        code = self.read_int(attributes, key, where)
        if code is None:
            return None
        if code not in _ABILITIES:
            self.error(f"{where}: unknown ability code {key}={code}")
            return None
        return _ABILITIES[code]

    def parse(self, function, value: str | None, where: str) -> list[dict]:
        try:
            return function(value or "")
        except selectors.UnknownSelector as e:
            self.error(f"{where}: unknown selector or requirement {e.text!r}")
            return []

    def unique_names(self, nodes: list[dict], kind: str) -> dict[str, dict]:
        """Index nodes by Name; a Name used twice is an error."""
        by_name: dict[str, list[str]] = {}
        for n in nodes:
            by_name.setdefault(n["attributes"].get("Name", ""), []).append(n["attributes"]["UUID"])
        res = {}
        for n in nodes:
            name = n["attributes"].get("Name", "")
            uuids = by_name[name]
            if not name:
                self.error(f"{kind} {n['attributes']['UUID']}: missing Name")
            elif len(uuids) > 1:
                if uuids[0] == n["attributes"]["UUID"]:
                    self.error(f"duplicate {kind} Name {name}: {', '.join(uuids)}")
            else:
                res[name] = n
        return res

    # --- sections ---

    def classes(self) -> dict:
        nodes = list(self.lsx["ClassDescriptions"].values())
        names = {n["attributes"]["UUID"]: n["attributes"].get("Name") for n in nodes}
        res = {}
        for name, n in self.unique_names(nodes, "class").items():
            a = n["attributes"]
            where = f"class {name}"
            parent = _uuid(a.get("ParentGuid"))
            if parent is not None and parent not in names:
                self.error(f"{where}: parent class not found {parent}")
            table = _uuid(a.get("ProgressionTableUUID"))
            if table is None:
                self.error(f"{where}: missing ProgressionTableUUID")
            res[name] = {
                "uuid": a["UUID"],
                "parent": names.get(parent) if parent else None,
                "table": table,
                "spellcasting_ability": self.ability(a, "SpellCastingAbility", where),
                "primary_ability": self.ability(a, "PrimaryAbility", where),
                "base_hp": self.read_int(a, "BaseHp", where),
                "hp_per_level": self.read_int(a, "HpPerLevel", where),
                "spell_list": _uuid(a.get("SpellList")),
                "prepares_spells": self.read_bool(a, "MustPrepareSpells", where),
                "multiclass_modifier": self.read_float(a, "MulticlassSpellcasterModifier", where),
                "text": _text(a),
            }
        return res

    def races(self) -> dict:
        all_races = self.lsx["Races"]
        kept_uuids = []
        for preset_uuid, preset in self.presets.items():
            for key in ("RaceUUID", "SubRaceUUID"):
                race = _uuid(preset["attributes"].get(key))
                if race is None:
                    continue
                if race not in all_races:
                    self.error(f"preset {preset_uuid}: {key} not found {race}")
                elif race not in kept_uuids:
                    kept_uuids.append(race)
        kept = [all_races[u] for u in kept_uuids]
        names = {n["attributes"]["UUID"]: n["attributes"].get("Name") for n in kept}
        res = {}
        for name, n in self.unique_names(kept, "race").items():
            a = n["attributes"]
            parent = _uuid(a.get("ParentGuid"))
            if parent is not None and parent not in names:
                self.error(f"race {name}: parent race {parent} is not a playable race")
            res[name] = {
                "uuid": a["UUID"],
                "parent": names.get(parent) if parent else None,
                "table": _uuid(a.get("ProgressionTableUUID")),
                "text": _text(a),
            }
        return res

    def backgrounds(self) -> dict:
        res = {}
        for uuid, n in self.lsx["Backgrounds"].items():
            a = n["attributes"]
            res[uuid] = {
                "passives": _split(a.get("Passives")),
                "origin": self.read_bool(a, "Hidden", f"background {uuid}"),
                "text": _text(a),
            }
        return res

    def feats(self) -> dict:
        descriptions: dict[str, dict] = {}
        for n in self.lsx["FeatDescriptions"].values():
            feat_id = n["attributes"].get("FeatId", "")
            if feat_id in descriptions:
                self.error(f"duplicate feat description for FeatId {feat_id}")
            descriptions[feat_id] = n
        res = {}
        for name, n in self.unique_names(list(self.lsx["Feats"].values()), "feat").items():
            a = n["attributes"]
            where = f"feat {name}"
            description = descriptions.get(a["UUID"])
            if description is None:
                self.error(f"{where}: no FeatDescription for {a['UUID']}")
            res[name] = {
                "uuid": a["UUID"],
                "passives": _split(a.get("PassivesAdded")),
                "selectors": self.parse(selectors.parse, a.get("Selectors"), where),
                "requirements": self.parse(selectors.requirements, a.get("Requirements"), where),
                "repeatable": self.read_bool(a, "CanBeTakenMultipleTimes", where),
                "text": _text(description["attributes"]) if description else {"name": None, "description": None},
            }
        return res

    def progressions(self, classes: dict, races: dict) -> list[dict]:
        tables = {c["table"] for c in classes.values()} | {r["table"] for r in races.values()}
        tables.discard(None)
        class_names = {n["attributes"]["UUID"]: n["attributes"].get("Name")
                       for n in self.lsx["ClassDescriptions"].values()}
        res = []
        for uuid, n in self.lsx["Progressions"].items():
            a = n["attributes"]
            if a.get("TableUUID") not in tables:
                continue
            where = f"progression {uuid} ({a.get('Name', '')})"
            kind = _PROGRESSION_TYPES.get(a.get("ProgressionType", ""))
            if kind is None:
                self.error(f"{where}: unknown ProgressionType {a.get('ProgressionType')!r}")
            subclasses = []
            for group in n["children"]:
                if group["id"] != "SubClasses":
                    continue
                for child in group["children"]:
                    if child["id"] != "SubClass":
                        continue
                    target = child["attributes"].get("Object", "")
                    if target in class_names:
                        subclasses.append(class_names[target])
                    else:
                        self.error(f"{where}: subclass not found {target}")
            res.append({
                "uuid": uuid,
                "table": a["TableUUID"],
                "name": a.get("Name"),
                "level": self.read_int(a, "Level", where, required=True),
                "type": kind,
                "multiclass": self.read_bool(a, "IsMulticlass", where),
                "feat": self.read_bool(a, "AllowImprovement", where),
                "boosts": _split(a.get("Boosts")),
                "passives_added": _split(a.get("PassivesAdded")),
                "passives_removed": _split(a.get("PassivesRemoved")),
                "selectors": self.parse(selectors.parse, a.get("Selectors"), where),
                "subclasses": subclasses,
            })
        res.sort(key=lambda p: (p["table"], p["level"] or 0, p["multiclass"], p["uuid"]))
        return res

    def lists(self, referencing: list[tuple[str, list[dict]]]) -> dict:
        available: dict[str, tuple[str, dict, str, str, str]] = {}
        for file, (kind, attribute, separator) in _LIST_FILES.items():
            for uuid, n in self.lsx[file].items():
                if uuid in available:
                    self.error(f"duplicate list UUID {uuid} in {available[uuid][0]} and {file}")
                    continue
                available[uuid] = (file, n, kind, attribute, separator)
        wanted: list[str] = []
        for where, parsed in referencing:
            for s in parsed:
                uuid = s.get("list")
                if uuid not in available:
                    self.error(f"{where}: {s['function']} references unknown list {uuid}")
                elif uuid not in wanted:
                    wanted.append(uuid)
        res = {}
        for uuid in sorted(wanted):
            _, n, kind, attribute, separator = available[uuid]
            res[uuid] = {
                "name": n["attributes"].get("Name"),
                "type": kind,
                "items": _split(n["attributes"].get(attribute), separator),
            }
        return res

    def stats_entries(self, names: list[str], kind: str, where: dict[str, str]) -> dict[str, dict]:
        res = {}
        for name in sorted(set(names)):
            entry = self.stats.get(name)
            if entry is None:
                self.error(f"{kind} {name} not found in stats (referenced by {where[name]})")
                continue
            res[name] = entry
        return res

    def build(self) -> dict:
        classes = self.classes()
        races = self.races()
        backgrounds = self.backgrounds()
        feats = self.feats()
        progressions = self.progressions(classes, races)
        referencing = [(f"progression {p['uuid']}", p["selectors"]) for p in progressions]
        referencing += [(f"feat {name}", f["selectors"]) for name, f in feats.items()]
        lists = self.lists(referencing)

        spell_refs: dict[str, str] = {}
        passive_refs: dict[str, str] = {}
        for uuid, l in lists.items():
            refs = {"spells": spell_refs, "passives": passive_refs}.get(l["type"])
            if refs is not None:
                for item in l["items"]:
                    refs.setdefault(item, f"list {uuid}")
        for p in progressions:
            for item in p["passives_added"] + p["passives_removed"]:
                passive_refs.setdefault(item, f"progression {p['uuid']}")
        for uuid, b in backgrounds.items():
            for item in b["passives"]:
                passive_refs.setdefault(item, f"background {uuid}")
        for name, f in feats.items():
            for item in f["passives"]:
                passive_refs.setdefault(item, f"feat {name}")

        spells = {}
        for name, s in self.stats_entries(list(spell_refs), "spell", spell_refs).items():
            spells[name] = {
                "type": s.get("SpellType") or s.get("type"),
                "level": self.read_int(s, "Level", f"spell {name}"),
                "school": s.get("SpellSchool") or None,
                "text": _text(s),
            }
        passives = {name: {"text": _text(s)}
                    for name, s in self.stats_entries(list(passive_refs), "passive", passive_refs).items()}

        if self.errors:
            raise ModelError(self.errors)
        return {
            "classes": dict(sorted(classes.items())),
            "races": dict(sorted(races.items())),
            "backgrounds": dict(sorted(backgrounds.items())),
            "feats": dict(sorted(feats.items())),
            "progressions": progressions,
            "lists": lists,
            "spells": spells,
            "passives": passives,
        }


def build(lsx_by_file: dict[str, dict[str, dict]], presets: dict[str, dict], stats: dict[str, dict]) -> dict:
    """The rules (schema of `data/larian/rules.json`); raises ModelError with every defect found."""
    return _Builder(lsx_by_file, presets, stats).build()
