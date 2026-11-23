"""Lecture des fichiers LSX (XML) du jeu, avec surcharge par UUID entre couches de modules."""
import xml.etree.ElementTree as ET

Noeud = dict  # {"id": str, "attributs": dict[str, str], "enfants": list[Noeud]}


def _noeud(el: ET.Element) -> Noeud:
    attributs = {}
    for a in el.findall("attribute"):
        # Un TranslatedString n'a pas de « value » : son handle tient lieu de valeur.
        if a.get("type") == "TranslatedString":
            attributs[a.get("id")] = a.get("handle", "")
        else:
            attributs[a.get("id")] = a.get("value", "")
    conteneur = el.find("children")
    enfants = [_noeud(e) for e in conteneur.findall("node")] if conteneur is not None else []
    return {"id": el.get("id"), "attributs": attributs, "enfants": enfants}


def noeuds(xml: bytes, type_noeud: str) -> list[Noeud]:
    """Nœuds de ce type, enfants directs d'un nœud « root », dans l'ordre du fichier."""
    res = []
    for region in ET.fromstring(xml).findall("region"):
        for racine in region.findall("node"):
            if racine.get("id") != "root":
                continue
            conteneur = racine.find("children")
            if conteneur is None:
                continue
            res.extend(_noeud(e) for e in conteneur.findall("node") if e.get("id") == type_noeud)
    return res


def fusionner(couches: list[list[Noeud]]) -> dict[str, Noeud]:
    """Indexe par UUID ; la couche la plus tardive remplace le nœud entier (pas de fusion champ à champ)."""
    res: dict[str, Noeud] = {}
    for couche in couches:
        vus: set[str] = set()
        for n in couche:
            uuid = n["attributs"].get("UUID")
            if not uuid:
                raise ValueError(f"nœud {n['id']} sans attribut UUID")
            if uuid in vus:
                raise ValueError(f"UUID {uuid} en double dans une même couche ({n['id']})")
            vus.add(uuid)
            res[uuid] = n
    return res
