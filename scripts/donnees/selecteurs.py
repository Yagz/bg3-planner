"""Analyse des sélecteurs de progression et des prérequis de dons : toute forme inconnue est refusée."""
import re


class SelecteurInconnu(Exception):
    """Fonction inconnue, argument invalide ou trop d'arguments ; porte le texte fautif."""

    def __init__(self, texte: str):
        super().__init__(texte)
        self.texte = texte


_APPEL = re.compile(r"^(\w+)\((.*)\)$", re.DOTALL)

# Champs positionnels par fonction ; « int » marque les champs numériques, « bool » les booléens.
_CHAMPS = {
    "AddSpells": ["liste", "id", "caracteristique", "ressource", "preparation", "recharge"],
    "SelectSpells": ["liste", "nombre", "remplacements", "id", "caracteristique", "ressource", "preparation", "recharge", "classe"],
    "SelectPassives": ["liste", "nombre", "id"],
    "ReplacePassives": ["liste", "nombre", "id"],
    "SelectEquipment": ["liste", "nombre", "id"],
    "SelectSkills": ["liste", "nombre", "id"],
    "SelectSkillsExpertise": ["liste", "nombre", "maitrise_requise", "id"],
    "SelectAbilities": ["liste", "nombre", "maximum", "id"],
    "SelectAbilityBonus": ["liste", "id"],  # + « bonus » : tous les arguments restants
}
_ENTIERS = {"nombre", "remplacements", "maximum"}


def _segments(chaine: str) -> list[str]:
    """Découpe sur « ; » hors parenthèses ; ignore les segments vides."""
    morceaux, profondeur, debut = [], 0, 0
    for i, c in enumerate(chaine):
        if c == "(":
            profondeur += 1
        elif c == ")":
            profondeur -= 1
        elif c == ";" and profondeur == 0:
            morceaux.append(chaine[debut:i])
            debut = i + 1
    morceaux.append(chaine[debut:])
    return [m.strip() for m in morceaux if m.strip()]


def _appel(segment: str) -> tuple[str, list[str]]:
    m = _APPEL.match(segment)
    if not m:
        raise SelecteurInconnu(segment)
    corps = m.group(2).strip()
    return m.group(1), [a.strip() for a in corps.split(",")] if corps else []


def _entier(valeur: str, segment: str) -> int:
    try:
        return int(valeur)
    except ValueError:
        raise SelecteurInconnu(segment) from None


def _selecteur(segment: str) -> dict:
    fonction, args = _appel(segment)
    if fonction not in _CHAMPS:
        raise SelecteurInconnu(segment)
    champs = _CHAMPS[fonction]
    if fonction == "SelectAbilityBonus":
        resultat = {"fonction": fonction}
        for i, nom in enumerate(champs):
            resultat[nom] = args[i] or None if i < len(args) else None
        resultat["bonus"] = [_entier(a, segment) for a in args[len(champs):]]
        return resultat
    if len(args) > len(champs):
        raise SelecteurInconnu(segment)
    resultat = {"fonction": fonction}
    for i, nom in enumerate(champs):
        brut = args[i] if i < len(args) else ""
        if brut == "":
            resultat[nom] = None
        elif nom in _ENTIERS:
            resultat[nom] = _entier(brut, segment)
        elif nom == "maitrise_requise":
            if brut not in ("true", "false"):
                raise SelecteurInconnu(segment)
            resultat[nom] = brut == "true"
        else:
            resultat[nom] = brut
    return resultat


def analyser(chaine: str) -> list[dict]:
    return [_selecteur(s) for s in _segments(chaine)]


def _texte(valeur: str) -> str:
    return valeur.strip("'")


def _prerequis(segment: str) -> dict:
    fonction, args = _appel(segment)
    if fonction == "FeatRequirementAbilityGreaterEqual" and len(args) == 2:
        return {"type": "caracteristique_min", "caracteristique": _texte(args[0]), "valeur": _entier(args[1], segment)}
    if fonction == "FeatRequirementProficiency" and len(args) == 1:
        return {"type": "maitrise", "maitrise": _texte(args[0])}
    raise SelecteurInconnu(segment)


def prerequis(chaine: str) -> list[dict]:
    return [_prerequis(s) for s in _segments(chaine)]
