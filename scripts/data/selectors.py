"""Parsing of progression selectors and feat requirements: any unknown form is refused."""
import re


class UnknownSelector(Exception):
    """Unknown function, invalid argument or too many arguments; carries the offending text."""

    def __init__(self, text: str):
        super().__init__(text)
        self.text = text


_CALL = re.compile(r"^(\w+)\((.*)\)$", re.DOTALL)

# Positional fields per function; "int" marks the numeric fields, "bool" the boolean ones.
_FIELDS = {
    "AddSpells": ["list", "id", "ability", "resource", "prepare", "cooldown"],
    "SelectSpells": ["list", "count", "swaps", "id", "ability", "resource", "prepare", "cooldown", "class"],
    "SelectPassives": ["list", "count", "id"],
    "ReplacePassives": ["list", "count", "id"],
    "SelectEquipment": ["list", "count", "id"],
    "SelectSkills": ["list", "count", "id"],
    "SelectSkillsExpertise": ["list", "count", "requires_proficiency", "id"],
    "SelectAbilities": ["list", "count", "max", "id"],
    "SelectAbilityBonus": ["list", "id"],  # + "bonuses": all the remaining arguments
}
_INTS = {"count", "swaps", "max"}


def _segments(string: str) -> list[str]:
    """Split on ";" outside parentheses; skip empty segments."""
    pieces, depth, start = [], 0, 0
    for i, c in enumerate(string):
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == ";" and depth == 0:
            pieces.append(string[start:i])
            start = i + 1
    pieces.append(string[start:])
    return [p.strip() for p in pieces if p.strip()]


def _call(segment: str) -> tuple[str, list[str]]:
    m = _CALL.match(segment)
    if not m:
        raise UnknownSelector(segment)
    body = m.group(2).strip()
    return m.group(1), [a.strip() for a in body.split(",")] if body else []


def _int(value: str, segment: str) -> int:
    try:
        return int(value)
    except ValueError:
        raise UnknownSelector(segment) from None


def _selector(segment: str) -> dict:
    function, args = _call(segment)
    if function not in _FIELDS:
        raise UnknownSelector(segment)
    fields = _FIELDS[function]
    if function == "SelectAbilityBonus":
        result = {"function": function}
        for i, name in enumerate(fields):
            result[name] = args[i] or None if i < len(args) else None
        result["bonuses"] = [_int(a, segment) for a in args[len(fields):]]
        return result
    if len(args) > len(fields):
        raise UnknownSelector(segment)
    result = {"function": function}
    for i, name in enumerate(fields):
        raw = args[i] if i < len(args) else ""
        if raw == "":
            result[name] = None
        elif name in _INTS:
            result[name] = _int(raw, segment)
        elif name == "requires_proficiency":
            if raw not in ("true", "false"):
                raise UnknownSelector(segment)
            result[name] = raw == "true"
        else:
            result[name] = raw
    return result


def parse(string: str) -> list[dict]:
    return [_selector(s) for s in _segments(string)]


def _text(value: str) -> str:
    return value.strip("'")


def _requirement(segment: str) -> dict:
    function, args = _call(segment)
    if function == "FeatRequirementAbilityGreaterEqual" and len(args) == 2:
        return {"type": "ability_min", "ability": _text(args[0]), "value": _int(args[1], segment)}
    if function == "FeatRequirementProficiency" and len(args) == 1:
        return {"type": "proficiency", "proficiency": _text(args[0])}
    raise UnknownSelector(segment)


def requirements(string: str) -> list[dict]:
    return [_requirement(s) for s in _segments(string)]
