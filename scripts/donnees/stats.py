"""Lecture des fichiers de statistiques du jeu (sorts, passifs…), avec remplacement et héritage `using`."""
import re

Entree = dict  # {"nom": str, "type": str, "parent": str | None, "data": dict[str, str]}

_NOUVELLE = re.compile(r'new entry "([^"]*)"')
_TYPE = re.compile(r'type "([^"]*)"')
_USING = re.compile(r'using "([^"]*)"')
_DATA_DEBUT = re.compile(r'data "([^"]*)" "(.*)', re.DOTALL)


class ErreurStats(Exception):
    """Fichier mal formé ou héritage irrésoluble ; `erreurs` porte tous les cas trouvés."""

    def __init__(self, erreurs: list[str]):
        self.erreurs = list(erreurs)
        super().__init__("\n".join(self.erreurs))


def entrees(texte: str) -> list[Entree]:
    """Entrées du fichier, dans l'ordre ; toute ligne non reconnue est une erreur."""
    res: list[Entree] = []
    erreurs: list[str] = []
    courante = None
    lignes = texte.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(lignes):
        no = i + 1
        ligne = lignes[i].strip()
        i += 1
        if not ligne or ligne.startswith("//"):
            continue
        if m := _NOUVELLE.fullmatch(ligne):
            courante = {"nom": m[1], "type": "", "parent": None, "data": {}}
            res.append(courante)
        elif courante is None:
            erreurs.append(f"ligne {no} : {ligne!r} avant toute « new entry »")
        elif m := _TYPE.fullmatch(ligne):
            courante["type"] = m[1]
        elif m := _USING.fullmatch(ligne):
            courante["parent"] = m[1]
        elif m := _DATA_DEBUT.fullmatch(ligne):
            # La valeur court jusqu'à la ligne qui porte le guillemet fermant ; ses retours
            # à la ligne sont conservés tels quels (normalisés en \n), sans rognage.
            morceaux = [m[2]]
            while not morceaux[-1].rstrip().endswith('"'):
                if i >= len(lignes):
                    erreurs.append(f"ligne {no} : valeur de « {m[1]} » non terminée en fin de fichier")
                    morceaux = None
                    break
                morceaux.append(lignes[i])
                i += 1
            if morceaux is not None:
                morceaux[-1] = morceaux[-1].rstrip()[:-1]
                courante["data"][m[1]] = "\n".join(morceaux)
        else:
            erreurs.append(f"ligne {no} : ligne non reconnue {ligne!r}")
    if erreurs:
        raise ErreurStats(erreurs)
    return res


def fusionner(couches: list[list[Entree]]) -> dict[str, dict]:
    """Dictionnaire résolu de la dernière définition de chaque nom.

    Une redéfinition (autre couche ou même couche) remplace l'entrée entière ; un `using` vers
    son propre nom désigne la définition précédente de ce nom ; un `using` vers un autre nom
    désigne la dernière définition de ce nom.
    """
    definitions: dict[str, list[Entree]] = {}
    for couche in couches:
        for e in couche:
            definitions.setdefault(e["nom"], []).append(e)

    erreurs: list[str] = []
    cycles: set[frozenset] = set()
    memo: dict[tuple[str, int], dict | None] = {}  # None : irrésoluble (erreur déjà notée)

    def resoudre(nom: str, i: int, pile: list[tuple[str, int]]) -> dict | None:
        cle = (nom, i)
        if cle in memo:
            return memo[cle]
        if cle in pile:
            boucle = pile[pile.index(cle):]
            id_cycle = frozenset(boucle)
            if id_cycle not in cycles:
                cycles.add(id_cycle)
                erreurs.append("cycle d'héritage : " + " -> ".join(n for n, _ in boucle + [cle]))
            return None
        e = definitions[nom][i]
        parent = e["parent"]
        base: dict = {}
        ok = True
        if parent is not None:
            if parent == nom:
                if i == 0:
                    erreurs.append(f"{nom} : « using » de soi-même sans définition précédente")
                    ok = False
                else:
                    base = resoudre(nom, i - 1, pile + [cle])
            elif parent not in definitions:
                erreurs.append(f"{nom} : parent introuvable {parent}")
                ok = False
            else:
                base = resoudre(parent, len(definitions[parent]) - 1, pile + [cle])
            ok = ok and base is not None
        if not ok:
            memo[cle] = None
            return None
        res = dict(base)
        if e["type"]:
            res["type"] = e["type"]
        res.update(e["data"])
        memo[cle] = res
        return res

    sortie = {}
    for nom, defs in definitions.items():
        r = resoudre(nom, len(defs) - 1, [])
        if r is not None:
            sortie[nom] = r
    if erreurs:
        raise ErreurStats(erreurs)
    return sortie
