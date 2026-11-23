"""Reading the game's stats files (spells, passives…), with replacement and `using` inheritance."""
import re

Entry = dict  # {"name": str, "type": str, "parent": str | None, "data": dict[str, str]}

_NEW = re.compile(r'new entry "([^"]*)"')
_TYPE = re.compile(r'type "([^"]*)"')
_USING = re.compile(r'using "([^"]*)"')
_STATEMENT_START = re.compile(r'(?:new entry|type|using) "|data "[^"]*" "')
_DATA_START = re.compile(r'data "([^"]*)" "(.*)', re.DOTALL)


class StatsError(Exception):
    """Malformed file or unresolvable inheritance; `errors` carries every case found."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def entries(text: str) -> list[Entry]:
    """Entries of the file, in order; any unrecognised line is an error."""
    res: list[Entry] = []
    errors: list[str] = []
    current = None
    lines = text.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lines):
        no = i + 1
        raw = lines[i]
        line = raw.strip()
        i += 1
        if not line or line.startswith("//"):
            continue
        if m := _NEW.fullmatch(line):
            current = {"name": m[1], "type": "", "parent": None, "data": {}}
            res.append(current)
        elif current is None:
            errors.append(f"line {no}: {line!r} before any \"new entry\"")
        elif m := _TYPE.fullmatch(line):
            current["type"] = m[1]
        elif m := _USING.fullmatch(line):
            current["parent"] = m[1]
        elif m := _DATA_START.fullmatch(raw.lstrip()):
            # The value runs up to the line carrying the closing quote; its line breaks
            # are kept as they are (normalised to \n), without trimming.
            pieces = [m[2]]
            while not pieces[-1].rstrip().endswith('"'):
                if i >= len(lines):
                    errors.append(f"line {no}: value of \"{m[1]}\" unterminated at end of file")
                    pieces = None
                    break
                if _STATEMENT_START.match(lines[i].lstrip()):
                    errors.append(f"line {no}: value of \"{m[1]}\" unterminated before line {i + 1}")
                    pieces = None
                    break
                pieces.append(lines[i])
                i += 1
            if pieces is not None:
                pieces[-1] = pieces[-1].rstrip()[:-1]
                current["data"][m[1]] = "\n".join(pieces)
        else:
            errors.append(f"line {no}: unrecognised line {line!r}")
    if errors:
        raise StatsError(errors)
    return res


def merge(layers: list[list[Entry]]) -> dict[str, dict]:
    """Resolved dictionary of the last definition of each name.

    A redefinition (other layer or same layer) replaces the whole entry; a `using` pointing to
    its own name designates the previous definition of that name; a `using` pointing to another
    name designates the last definition of that name.
    """
    definitions: dict[str, list[Entry]] = {}
    for layer in layers:
        for e in layer:
            definitions.setdefault(e["name"], []).append(e)

    errors: list[str] = []
    cycles: set[frozenset] = set()
    memo: dict[tuple[str, int], dict | None] = {}  # None: unresolvable (error already recorded)

    def resolve(name: str, i: int, stack: list[tuple[str, int]]) -> dict | None:
        key = (name, i)
        if key in memo:
            return memo[key]
        if key in stack:
            loop = stack[stack.index(key):]
            cycle_id = frozenset(loop)
            if cycle_id not in cycles:
                cycles.add(cycle_id)
                errors.append("inheritance cycle: " + " -> ".join(n for n, _ in loop + [key]))
            return None
        e = definitions[name][i]
        parent = e["parent"]
        base: dict = {}
        ok = True
        if parent is not None:
            if parent == name:
                if i == 0:
                    errors.append(f"{name}: \"using\" of itself without a previous definition")
                    ok = False
                else:
                    base = resolve(name, i - 1, stack + [key])
            elif parent not in definitions:
                errors.append(f"{name}: parent not found {parent}")
                ok = False
            else:
                base = resolve(parent, len(definitions[parent]) - 1, stack + [key])
            ok = ok and base is not None
        if not ok:
            memo[key] = None
            return None
        res = dict(base)
        if e["type"]:
            res["type"] = e["type"]
        res.update(e["data"])
        memo[key] = res
        return res

    output = {}
    for name, defs in definitions.items():
        r = resolve(name, len(defs) - 1, [])
        if r is not None:
            output[name] = r
    if errors:
        raise StatsError(errors)
    return output
