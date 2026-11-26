"""Choice of sources: which paks and modules the import reads, in which override order."""
import re
from pathlib import Path

from scripts.data.pak import read_pak

RULES_PAKS = ("Shared.pak", "Gustav.pak", "GustavX.pak")
# Interface files (skill descriptions, slot and damage type names) are read from this pak only.
GAME_PAK = "Game.pak"
# Hotfix paks (Data/Patch*.pak) must not touch rules files: they are checked, never read.
HOTFIX_GLOB = "Patch*.pak"
# Override order taken from the meta.lsx files: the last one wins. Honour and HonourX (Honour mode) are excluded.
MODULES = ("Shared", "SharedDev", "Gustav", "GustavDev", "GustavX")

_PATH = re.compile(r"Public/([^/]+)/(.+)$")


class UnexpectedSource(Exception):
    """An expected pak or file is missing, or a hotfix touches files the import reads."""


def _filter(pattern: re.Pattern, modules: tuple[str, ...] | None):
    def accepts(name: str) -> bool:
        m = _PATH.match(name)
        return bool(m) and (modules is None or m[1] in modules) and bool(pattern.search(m[2]))
    return accepts


def layers(game: Path, pattern: re.Pattern) -> list[tuple[str, str, bytes]]:
    """(module, path relative to the module, content) of the `Public/<module>/<path>` files whose path
    matches the pattern, sorted by module rank in MODULES then by path."""
    data = game / "Data"
    for path in sorted(data.glob(HOTFIX_GLOB)):
        touched = read_pak(path, _filter(pattern, None))
        if touched:
            raise UnexpectedSource(f"{path.name} contains rules files: {sorted(touched)}")
    found = []
    for name in RULES_PAKS:
        path = data / name
        if not path.exists():
            raise UnexpectedSource(f"rules pak not found: {path}")
        for file, content in read_pak(path, _filter(pattern, MODULES)).items():
            module, relative = _PATH.match(file).groups()
            found.append((module, relative, content))
    found.sort(key=lambda t: (MODULES.index(t[0]), t[1]))
    return found


def game_files(game: Path, names: tuple[str, ...]) -> dict[str, bytes]:
    """Content of the named files of `Data/Game.pak`, by name; raises UnexpectedSource when the pak is missing,
    a name is absent from it, or a hotfix pak holds one of the names."""
    data = game / "Data"
    wanted = set(names)
    for path in sorted(data.glob(HOTFIX_GLOB)):
        touched = read_pak(path, wanted.__contains__)
        if touched:
            raise UnexpectedSource(f"{path.name} contains interface files read from {GAME_PAK}: {sorted(touched)}")
    path = data / GAME_PAK
    if not path.exists():
        raise UnexpectedSource(f"interface pak not found: {path}")
    found = read_pak(path, wanted.__contains__)
    absent = [name for name in names if name not in found]
    if absent:
        raise UnexpectedSource(f"{GAME_PAK} lacks interface files: {absent}")
    return found
