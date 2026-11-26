"""Key items: scope from bg3.wiki's item list, rules from the game's item stats, names from its RootTemplates.

Scope: every wiki item whose `legacy` is null (obtainable), minus the entries of `items_excluded.txt`.
Each item is looked up by its wiki `uid` among the item stats (Armor.txt, Weapon.txt), the stats entry's
`RootTemplate` giving the template; failing that, as the Name of the template given by its wiki `uuid`,
that template's `Stats` giving the stats entry (`found_by` says which). The template's DisplayName and
Description are the item's texts.

The items of the equipment lists (`SelectEquipment`) outside that scope are added too (`found_by: "list"`),
by their stats entry and its RootTemplate. Every item carries its stats entry's `Weapon Properties`.
"""
import json
from pathlib import Path

# Wiki kind -> stats type of the item.
_STATS_TYPES = {"equipment": "Armor", "weapon": "Weapon"}
_KINDS = {stats_type: kind for kind, stats_type in _STATS_TYPES.items()}
WIKI = Path(__file__).resolve().parents[2] / "data" / "wiki" / "items.json"


def read_wiki(path: Path) -> dict[str, dict]:
    """The `items` of a `data/wiki/items.json` file, by uid."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("items"), dict):
        raise ValueError(f"{path}: no \"items\" object")
    return data["items"]


def scope(wiki: dict[str, dict], excluded: dict[str, str]) -> list[str]:
    """Uids of the obtainable wiki items that are not excluded, sorted."""
    return sorted(uid for uid, w in wiki.items() if w.get("legacy") is None and uid not in excluded)


def _locate(uid: str, w: dict, item_stats: dict, templates: dict) -> tuple[tuple | None, list[str]]:
    """(found_by, stats entry, template uuid) of one item, or the errors that prevent finding it.

    By stats name: the uid is an item stats entry, whose RootTemplate must equal the wiki uuid when
    given. By template: the uid is the Name of the template given by the wiki uuid, and that
    template's Stats is an item stats entry.
    """
    where = f"item {uid}"
    entry = item_stats.get(uid)
    if entry is not None:
        root = entry.get("RootTemplate") or None
        if root is None:
            return None, [f"{where}: stats entry has no RootTemplate"]
        if w.get("uuid") and w["uuid"] != root:
            return None, [f"{where}: wiki uuid {w['uuid']} differs from the stats RootTemplate {root}"]
        return ("stats", entry, root), []
    uuid = w.get("uuid")
    template = templates.get(uuid) if uuid else None
    if template is None:
        return None, [f"{where}: not found in the item stats (Armor.txt, Weapon.txt), and its wiki uuid {uuid} "
                      "is not a RootTemplate"]
    if template.get("name") != uid:
        return None, [f"{where}: not found in the item stats (Armor.txt, Weapon.txt), and its wiki uuid's "
                      f"template {uuid} is named {template.get('name')!r}"]
    entry = item_stats.get(template.get("stats") or "")
    if entry is None:
        return None, [f"{where}: template {uuid} has Stats {template.get('stats')!r}, not an item stats entry"]
    return ("template", entry, uuid), []


def _rules(uid: str, kind: str, found_by: str, entry: dict, root: str, templates: dict,
           handle) -> tuple[dict | None, list[str]]:
    """One item's rules from its stats entry and RootTemplate, or the errors that prevent them."""
    where = f"item {uid}"
    template = templates.get(root)
    if template is None:
        return None, [f"{where}: RootTemplate {root} not found among the templates"]
    name = handle(template.get("display_name"))
    if name is None:
        return None, [f"{where}: template {root} has no DisplayName"]
    properties = [p.strip() for p in (entry.get("Weapon Properties") or "").split(";") if p.strip()]
    if entry.get("type") == "Weapon" and not properties:
        return None, [f"{where}: weapon without Weapon Properties"]
    return {
        "kind": kind,
        "found_by": found_by,
        "stats_type": entry.get("type"),
        "slot": entry.get("Slot") or None,
        "rarity": entry.get("Rarity") or None,
        "root_template": root,
        "properties": properties,
        "text": {"name": name, "description": handle(template.get("description"))},
    }, []


def _item(uid: str, w: dict, item_stats: dict, templates: dict, handle) -> tuple[dict | None, list[str]]:
    """One wiki item's rules, or the errors that prevent them."""
    found, errors = _locate(uid, w, item_stats, templates)
    if found is None:
        return None, errors
    found_by, entry, root = found
    if _STATS_TYPES.get(w.get("kind")) != entry.get("type"):
        return None, [f"item {uid}: wiki kind {w.get('kind')!r} does not match the stats type {entry.get('type')!r}"]
    return _rules(uid, w.get("kind"), found_by, entry, root, templates, handle)


def build(wiki: dict[str, dict], item_stats: dict[str, dict], templates: dict[str, dict],
          excluded: dict[str, str], handle) -> tuple[dict, list[str]]:
    """The `items` section of the rules, with every error found (an exclusion of a uid that is not an
    obtainable wiki item is one). `handle` turns a translation handle into its key (see model.handle)."""
    errors = []
    for uid in sorted(excluded):
        if uid not in wiki or wiki[uid].get("legacy") is not None:
            errors.append(f"items_excluded.txt: {uid} is not an obtainable wiki item; remove it")
        elif _item(uid, wiki[uid], item_stats, templates, handle)[0] is not None:
            errors.append(f"items_excluded.txt: {uid} is excluded but found without error; remove it")
    res = {}
    for uid in scope(wiki, excluded):
        item, problems = _item(uid, wiki[uid], item_stats, templates, handle)
        errors.extend(problems)
        if item is not None:
            res[uid] = item
    return res, errors


def list_items(lists: dict[str, dict], present: dict[str, dict], item_stats: dict[str, dict],
               templates: dict[str, dict], handle) -> tuple[dict[str, dict], list[str]]:
    """The items of the equipment lists that are not in `present` (the wiki-scoped items), with every error
    found. An item absent from the item stats is left to `equipment_problems`."""
    res, errors, seen = {}, [], set()
    for _, lst in sorted(lists.items()):
        if lst.get("type") != "equipment":
            continue
        for uid in lst.get("items", []):
            entry = item_stats.get(uid)
            if uid in present or uid in seen or entry is None:
                continue
            seen.add(uid)
            root = entry.get("RootTemplate") or None
            if root is None:
                errors.append(f"item {uid}: stats entry has no RootTemplate")
                continue
            kind = _KINDS.get(entry.get("type"))
            if kind is None:
                errors.append(f"item {uid}: unexpected stats type {entry.get('type')!r}")
                continue
            item, problems = _rules(uid, kind, "list", entry, root, templates, handle)
            errors.extend(problems)
            if item is not None:
                res[uid] = item
    return res, errors


def equipment_problems(lists: dict[str, dict], item_stats: dict[str, dict]) -> list[str]:
    """Items of the equipment lists that are not in the item stats."""
    return [f"list {uuid}: equipment item {item} not found in the item stats (Armor.txt, Weapon.txt)"
            for uuid, lst in sorted(lists.items()) if lst.get("type") == "equipment"
            for item in lst.get("items", []) if item not in item_stats]
