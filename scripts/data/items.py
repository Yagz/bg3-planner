"""Key items: scope from bg3.wiki's item list, rules from the game's item stats, names from its RootTemplates.

Scope: every wiki item whose `legacy` is null (obtainable), minus the entries of `items_excluded.txt`.
Each item is looked up by its wiki `uid` among the item stats (Armor.txt, Weapon.txt); the stats
entry's `RootTemplate` gives the template, whose DisplayName and Description are the item's texts.
"""
import json
from pathlib import Path

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


def _item(uid: str, w: dict, item_stats: dict, templates: dict, handle) -> tuple[dict | None, list[str]]:
    """One item's rules, or the errors that prevent them."""
    where = f"item {uid}"
    entry = item_stats.get(uid)
    if entry is None:
        return None, [f"{where}: not found in the item stats (Armor.txt, Weapon.txt)"]
    root = entry.get("RootTemplate") or None
    if root is None:
        return None, [f"{where}: stats entry has no RootTemplate"]
    errors = []
    if w.get("uuid") and w["uuid"] != root:
        errors.append(f"{where}: wiki uuid {w['uuid']} differs from the stats RootTemplate {root}")
    template = templates.get(root)
    if template is None:
        return None, errors + [f"{where}: RootTemplate {root} not found among the templates"]
    name = handle(template.get("display_name"))
    if name is None:
        return None, errors + [f"{where}: template {root} has no DisplayName"]
    if errors:
        return None, errors
    return {
        "kind": w.get("kind"),
        "stats_type": entry.get("type"),
        "slot": entry.get("Slot") or None,
        "rarity": entry.get("Rarity") or None,
        "root_template": root,
        "text": {"name": name, "description": handle(template.get("description"))},
    }, []


def build(wiki: dict[str, dict], item_stats: dict[str, dict], templates: dict[str, dict],
          excluded: dict[str, str], handle) -> tuple[dict, list[str]]:
    """The `items` section of the rules, with every error found (an exclusion of a uid that is not an
    obtainable wiki item is one). `handle` turns a translation handle into its key (see model.handle)."""
    errors = []
    for uid in sorted(excluded):
        if uid not in wiki or wiki[uid].get("legacy") is not None:
            errors.append(f"items_excluded.txt: {uid} is not an obtainable wiki item; remove it")
    res = {}
    for uid in scope(wiki, excluded):
        item, problems = _item(uid, wiki[uid], item_stats, templates, handle)
        errors.extend(problems)
        if item is not None:
            res[uid] = item
    return res, errors


def equipment_problems(lists: dict[str, dict], item_stats: dict[str, dict]) -> list[str]:
    """Items of the equipment lists that are not in the item stats."""
    return [f"list {uuid}: equipment item {item} not found in the item stats (Armor.txt, Weapon.txt)"
            for uuid, lst in sorted(lists.items()) if lst.get("type") == "equipment"
            for item in lst.get("items", []) if item not in item_stats]
