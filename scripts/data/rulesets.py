"""Rulesets (`Ruleset/Rulesets.lsx`) and the modifiers that shape a build (`Ruleset/RulesetModifiers.lsx`,
`Ruleset/RulesetValues.lsx`): multiclassing and the proficiency bonus, from the difficulty or mode.

Only the rulesets the game's custom-mode screen shows are kept, with the values they give the build modifiers
(a modifier without a value keeps its default). Any unexpected type or value is an error, never a guess.
"""
from scripts.data import model

# The modifiers the planner applies; every other modifier is ignored.
BUILD_MODIFIERS = ("MULTICLASSING", "PROFICIENCY_BONUS", "HONOUR_STATS")
# RulesetModifierType -> kind of a build modifier: 1 integer, 4 boolean (2 float and 3 option are not build values).
_KINDS = {"1": "int", "4": "bool"}


def _parse(kind: str, text: str, definition: dict | None = None):
    """The bool or int in `text`, within the definition's bounds; ValueError when it is neither."""
    if kind == "bool":
        if text not in ("true", "false"):
            raise ValueError(f"not a boolean: {text!r}")
        return text == "true"
    try:
        value = int(text)
    except ValueError:
        raise ValueError(f"not an integer: {text!r}") from None
    if definition is not None:
        low, high = definition.get("min"), definition.get("max")
        if (low is not None and value < low) or (high is not None and value > high):
            raise ValueError(f"{value} is outside {low}..{high}")
    return value


def _definitions(modifiers: dict[str, dict], errors: list[str]) -> tuple[dict[str, dict], dict[str, str]]:
    """(definitions of the build modifiers by Name, Name of every modifier by UUID)."""
    names = {uuid: n["attributes"].get("Name", "") for uuid, n in modifiers.items()}
    definitions: dict[str, dict] = {}
    for name in BUILD_MODIFIERS:
        found = [(uuid, modifiers[uuid]["attributes"]) for uuid, n in names.items() if n == name]
        where = f"ruleset modifier {name}"
        if len(found) != 1:
            errors.append(f"{where}: {'missing' if not found else 'defined ' + str(len(found)) + ' times'}")
            continue
        a = found[0][1]
        kind = _KINDS.get(a.get("RulesetModifierType", ""))
        if kind is None:
            errors.append(f"{where}: unexpected RulesetModifierType {a.get('RulesetModifierType')!r}, expected 1 or 4")
            continue
        definition: dict = {"type": kind}
        try:
            if kind == "int":
                for field, attribute in (("min", "Min"), ("max", "Max")):
                    if a.get(attribute, "") != "":
                        definition[field] = _parse("int", a[attribute])
            definition["default"] = _parse(kind, a.get("Default", ""), definition)
        except ValueError as e:
            errors.append(f"{where}: invalid Default or bounds: {e}")
            continue
        if a.get("ShowInCustom", "") not in ("", "true", "false"):
            errors.append(f"{where}: invalid boolean ShowInCustom={a['ShowInCustom']!r}")
            continue
        definition["custom"] = a.get("ShowInCustom") == "true"
        definitions[name] = {k: definition[k] for k in ("type", "default", "min", "max", "custom") if k in definition}
    return definitions, names


def build(rulesets: dict[str, dict], modifiers: dict[str, dict], values: dict[str, dict]
          ) -> tuple[dict[str, dict], dict[str, dict], list[str]]:
    """(shown rulesets by Name in file order, each with `values` and `text` handles; definitions of the build
    modifiers by Name; every error found). The arguments are the merged LSX nodes by UUID. A value of a modifier
    that is not a build modifier, or of a ruleset the custom-mode screen does not show, is ignored; a value naming
    an unknown ruleset or modifier is an error."""
    errors: list[str] = []
    definitions, names = _definitions(modifiers, errors)
    shown: dict[str, dict] = {}
    by_uuid: dict[str, dict | None] = {}
    for uuid, n in rulesets.items():
        a = n["attributes"]
        name = a.get("Name", "")
        if not name:
            errors.append(f"ruleset {uuid}: missing Name")
            by_uuid[uuid] = None
            continue
        flag = a.get("ShowInCustom", "")
        if flag not in ("", "true", "false"):
            errors.append(f"ruleset {name}: invalid boolean ShowInCustom={flag!r}")
        if flag == "true":
            if name in shown:
                errors.append(f"duplicate ruleset Name {name}")
            shown[name] = {"values": {}, "text": model._text(a)}
            by_uuid[uuid] = shown[name]
        else:
            by_uuid[uuid] = None
    for uuid, n in values.items():
        a = n["attributes"]
        ruleset_uuid, modifier_uuid = a.get("Ruleset", ""), a.get("Modifier", "")
        where = f"ruleset value {uuid}"
        known = True
        if ruleset_uuid not in by_uuid:
            errors.append(f"{where}: unknown ruleset {ruleset_uuid}")
            known = False
        if modifier_uuid not in names:
            errors.append(f"{where}: unknown modifier {modifier_uuid}")
            known = False
        if not known or names[modifier_uuid] not in BUILD_MODIFIERS:
            continue
        name = names[modifier_uuid]
        definition = definitions.get(name)
        if definition is None:
            continue
        try:
            value = _parse(definition["type"], a.get("Value", ""), definition)
        except ValueError as e:
            errors.append(f"{where} ({name}): {e}")
            continue
        target = by_uuid[ruleset_uuid]
        if target is not None:
            target["values"][name] = value
    return shown, definitions, errors
