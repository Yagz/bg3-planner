"""Reading the game's LSX (XML) files, with override by UUID between module layers."""
import xml.etree.ElementTree as ET

Node = dict  # {"id": str, "attributes": dict[str, str], "children": list[Node]}


def _node(el: ET.Element) -> Node:
    attributes = {}
    for a in el.findall("attribute"):
        # A TranslatedString has no "value": its handle stands in for the value.
        if a.get("type") == "TranslatedString":
            attributes[a.get("id")] = a.get("handle", "")
        else:
            attributes[a.get("id")] = a.get("value", "")
    container = el.find("children")
    children = [_node(e) for e in container.findall("node")] if container is not None else []
    return {"id": el.get("id"), "attributes": attributes, "children": children}


def nodes(xml: bytes, node_type: str) -> list[Node]:
    """Nodes of this type, direct children of a "root" node, in file order."""
    res = []
    for region in ET.fromstring(xml).findall("region"):
        for root in region.findall("node"):
            if root.get("id") != "root":
                continue
            container = root.find("children")
            if container is None:
                continue
            res.extend(_node(e) for e in container.findall("node") if e.get("id") == node_type)
    return res


def merge(layers: list[list[Node]]) -> dict[str, Node]:
    """Index by UUID; the latest layer replaces the whole node (no field-by-field merge)."""
    res: dict[str, Node] = {}
    for layer in layers:
        seen: set[str] = set()
        for n in layer:
            uuid = n["attributes"].get("UUID")
            if not uuid:
                raise ValueError(f"node {n['id']} without a UUID attribute")
            if uuid in seen:
                raise ValueError(f"duplicate UUID {uuid} within a single layer ({n['id']})")
            seen.add(uuid)
            res[uuid] = n
    return res
