"""Choice of sources: which paks and modules the import reads, in which override order."""
import re
from pathlib import Path

from scripts.data.pak import read_pak

RULES_PAKS = ("Shared.pak", "Gustav.pak", "GustavX.pak")
HOTFIX_PAKS = ("Patch8_HotFix9.pak", "Patch8_HotFix10.pak")
# Override order taken from the meta.lsx files: the last one wins. Honour and HonourX (Honour mode) are excluded.
MODULES = ("Shared", "SharedDev", "Gustav", "GustavDev", "GustavX")

_PATH = re.compile(r"Public/([^/]+)/(.+)$")


class UnexpectedSource(Exception):
    """An expected pak is missing, or a hotfix touches rules files."""


def _filter(pattern: re.Pattern, modules: tuple[str, ...] | None):
    def accepts(name: str) -> bool:
        m = _PATH.match(name)
        return bool(m) and (modules is None or m[1] in modules) and bool(pattern.search(m[2]))
    return accepts


def layers(game: Path, pattern: re.Pattern) -> list[tuple[str, str, bytes]]:
    """(module, path relative to the module, content) of the `Public/<module>/<path>` files whose path
    matches the pattern, sorted by module rank in MODULES then by path."""
    data = game / "Data"
    for name in HOTFIX_PAKS:
        path = data / name
        if path.exists():
            touched = read_pak(path, _filter(pattern, None))
            if touched:
                raise UnexpectedSource(f"{name} contains rules files: {sorted(touched)}")
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
