"""RootTemplates: merging the modules' templates in override order, then resolving ParentTemplateId inheritance."""
import re
from pathlib import Path

from scripts.data import lsf, sources

PATTERN = re.compile(r"^RootTemplates/_merged\.lsf$")
NODE_TYPE = "GameObjects"
INHERITED = ("Stats", "DisplayName", "Description")


class TemplateError(Exception):
    """Templates without MapKey, missing parents or inheritance cycles; `errors` lists all of them."""

    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


def merge(layers: list[list[dict]]) -> dict[str, dict]:
    """Templates by MapKey; a template of a later layer replaces the whole earlier one."""
    merged: dict[str, dict] = {}
    errors = []
    for layer in layers:
        for n in layer:
            key = n["attributes"].get("MapKey")
            if not key:
                errors.append(f"template without MapKey: {n['attributes'].get('Name', '?')}")
            else:
                merged[key] = n
    if errors:
        raise TemplateError(errors)
    return merged


def resolve(merged: dict[str, dict]) -> dict[str, dict]:
    """Per template: name, type, stats, display_name, description, parent; the last three attributes come
    from the nearest template of the parent chain that has them. Empty values count as absent."""
    errors = []
    for key in sorted(merged):
        seen = [key]
        cur = key
        while True:
            parent = merged[cur]["attributes"].get("ParentTemplateId") or None
            if parent is None:
                break
            if parent not in merged:
                message = f"missing parent {parent} of template {cur}"
                if message not in errors:
                    errors.append(message)
                break
            if parent in seen:
                cycle = seen[seen.index(parent):]
                if key == min(cycle):
                    errors.append("cycle: " + " -> ".join(cycle + [parent]))
                break
            seen.append(parent)
            cur = parent
    if errors:
        raise TemplateError(errors)
    out = {}
    for key, n in merged.items():
        a = n["attributes"]
        found = {}
        cur = key
        while cur is not None:
            ca = merged[cur]["attributes"]
            for f in INHERITED:
                if f not in found and ca.get(f):
                    found[f] = ca[f]
            cur = ca.get("ParentTemplateId") or None
        out[key] = {"name": a.get("Name"), "type": a.get("Type"), "stats": found.get("Stats"),
                    "display_name": found.get("DisplayName"), "description": found.get("Description"),
                    "parent": a.get("ParentTemplateId") or None}
    return out


def load(game: Path) -> dict[str, dict]:
    """Resolved templates of the real game, modules in override order."""
    per_module: dict[str, list[dict]] = {}
    for module, _, data in sources.layers(game, PATTERN):
        per_module.setdefault(module, []).extend(lsf.nodes(data, NODE_TYPE))
    return resolve(merge(list(per_module.values())))
