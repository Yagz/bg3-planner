"""Import command: reads the installed game (read-only) and writes `data/larian/`.

python3.14 -m scripts.data.importer --game <install dir> --game-version <version> --output data/larian \
    [--wiki data/wiki/items.json]

Nothing is written unless every step succeeded; every error list is printed to stderr.
"""
import argparse
import json
import os
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from scripts.data import items, loca, lsx, model, sources, stats, templates, texts

NOTICE = {"fr": "Projet de fans non commercial ; contenu propriété de Larian Studios.",
          "en": "Non-commercial fan project; content owned by Larian Studios."}
UNNAMED = Path(__file__).with_name("unnamed.txt")
GAME_TYPOS = Path(__file__).with_name("game_typos.txt")
KNOWN_DUPLICATES = Path(__file__).with_name("known_duplicates.txt")
ITEMS_EXCLUDED = Path(__file__).with_name("items_excluded.txt")
WIKI = items.WIKI

# Key expected by model.build -> (path relative to the module, node type).
LSX_FILES = {
    "Progressions": ("Progressions/Progressions.lsx", "Progression"),
    "SpellLists": ("Lists/SpellLists.lsx", "SpellList"),
    "PassiveLists": ("Lists/PassiveLists.lsx", "PassiveList"),
    "SkillLists": ("Lists/SkillLists.lsx", "SkillList"),
    "AbilityLists": ("Lists/AbilityLists.lsx", "AbilityList"),
    "EquipmentLists": ("Lists/EquipmentLists.lsx", "EquipmentList"),
    "ClassDescriptions": ("ClassDescriptions/ClassDescriptions.lsx", "ClassDescription"),
    "Races": ("Races/Races.lsx", "Race"),
    "Backgrounds": ("Backgrounds/Backgrounds.lsx", "Background"),
    "Feats": ("Feats/Feats.lsx", "Feat"),
    "FeatDescriptions": ("Feats/FeatDescriptions.lsx", "FeatDescription"),
}
PRESETS = ("CharacterCreationPresets/CharacterCreationPresets.lsx", "CharacterCreationPreset")
# Spell_*.txt and Passive.txt only: the other Data/*.txt files hold other formats.
STATS_PATTERN = re.compile(r"^Stats/Generated/Data/(?:Spell_[^/]+|Passive)\.txt$")
# Item stats, loaded apart: their names never mix with spells and passives.
ITEM_STATS_PATTERN = re.compile(r"^Stats/Generated/Data/(?:Armor|Weapon)\.txt$")
ENGLISH_PAK = Path("Localization/English.pak")
FRENCH_PAK = Path("Localization/French/French.pak")


class SourceErrors(Exception):
    """Errors gathered over several files; `errors` lists every case."""

    def __init__(self, errors: list[str]):
        self.errors = list(errors)
        super().__init__("\n".join(self.errors))


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True, indent=1) + "\n", encoding="utf-8")


def _by_module(found: list[tuple[str, str, bytes]]) -> list[list[tuple[str, bytes]]]:
    """One layer per module, in the order given by sources.layers (module rank, then path)."""
    layers: dict[str, list[tuple[str, bytes]]] = {}
    for module, relative, content in found:
        layers.setdefault(module, []).append((f"{module}/{relative}", content))
    return list(layers.values())


def _lsx(game: Path, relative: str, node_type: str, errors: list[str]) -> dict[str, dict]:
    pattern = re.compile(rf"^{re.escape(relative)}$")
    layers = []
    for layer in _by_module(sources.layers(game, pattern)):
        nodes = []
        for where, content in layer:
            try:
                nodes.extend(lsx.nodes(content, node_type))
            except (ET.ParseError, ValueError) as e:
                errors.append(f"{where}: {e}")
        layers.append(nodes)
    try:
        return lsx.merge(layers)
    except ValueError as e:
        errors.append(f"{relative}: {e}")
        return {}


def _stats(game: Path, pattern: re.Pattern, errors: list[str]) -> dict[str, dict]:
    layers = []
    unreadable = False
    for layer in _by_module(sources.layers(game, pattern)):
        entries = []
        for where, content in layer:
            try:
                entries.extend(stats.entries(content.decode("utf-8")))
            except stats.StatsError as e:
                errors.extend(f"{where}: {error}" for error in e.errors)
                unreadable = True
        layers.append(entries)
    if unreadable:
        return {}
    try:
        return stats.merge(layers)
    except stats.StatsError as e:
        errors.extend(f"stats: {error}" for error in e.errors)
        return {}


def _templates(game: Path, errors: list[str]) -> dict[str, dict]:
    try:
        return templates.load(game)
    except templates.TemplateError as e:
        errors.extend(f"RootTemplates: {error}" for error in e.errors)
    except ValueError as e:
        errors.append(f"RootTemplates: {e}")
    return {}


def build(game: Path, game_version: str, wiki: Path | None = None) -> dict[str, object]:
    """Contents of the four produced files, by file name; raises on any error. `wiki` is the bg3.wiki
    item file that sets the items' scope (default: WIKI)."""
    for pak in (ENGLISH_PAK, FRENCH_PAK):
        if not (game / "Data" / pak).exists():
            raise sources.UnexpectedSource(f"translation pak not found: {game / 'Data' / pak}")
    errors: list[str] = []
    lsx_by_file = {key: _lsx(game, relative, node_type, errors) for key, (relative, node_type) in LSX_FILES.items()}
    presets = _lsx(game, *PRESETS, errors)
    stats_by_name = _stats(game, STATS_PATTERN, errors)
    item_stats = _stats(game, ITEM_STATS_PATTERN, errors)
    resolved_templates = _templates(game, errors)
    if errors:
        raise SourceErrors(errors)
    rules = model.build(lsx_by_file, presets, stats_by_name, typos=model.read_typos(GAME_TYPOS),
                        duplicates=model.read_duplicates(KNOWN_DUPLICATES),
                        wiki=items.read_wiki(wiki or WIKI), item_stats=item_stats,
                        templates=resolved_templates, excluded=model.read_excluded(ITEMS_EXCLUDED))
    en = loca.table(game / "Data" / ENGLISH_PAK, "English")
    fr = loca.table(game / "Data" / FRENCH_PAK, "French")
    rules, texts_en, texts_fr = texts.resolve(rules, en, fr, texts.read_unnamed(UNNAMED),
                                             texts.read_unnamed_descriptions(UNNAMED))
    return {
        "meta.json": {"game": game_version, "modules": list(sources.MODULES), "notice": NOTICE},
        "rules.json": rules,
        "texts.en.json": texts_en,
        "texts.fr.json": texts_fr,
    }


def run(game: Path, output: Path, game_version: str, wiki: Path | None = None) -> None:
    """Import the game into `output`; nothing is written if any step fails."""
    contents = build(game, game_version, wiki)
    output.mkdir(parents=True, exist_ok=True)
    temporary = []
    try:
        for name, value in contents.items():
            tmp = output / f".{name}.tmp"
            temporary.append((tmp, output / name))
            write_json(tmp, value)
        for tmp, final in temporary:
            tmp.replace(final)
    finally:
        for tmp, _ in temporary:
            tmp.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3.14 -m scripts.data.importer", description=__doc__.splitlines()[0])
    parser.add_argument("--game", type=Path, default=os.environ.get("BG3_GAME"),
                        help="game install directory (default: $BG3_GAME)")
    parser.add_argument("--game-version", required=True, help="game version, e.g. 4.1.1.7631656")
    parser.add_argument("--output", type=Path, default=Path("data/larian"), help="output directory")
    parser.add_argument("--wiki", type=Path, default=None,
                        help="bg3.wiki item file setting the items' scope (default: data/wiki/items.json)")
    args = parser.parse_args(argv)
    if args.game is None:
        parser.error("--game is required when $BG3_GAME is not set")
    try:
        run(Path(args.game), args.output, args.game_version, args.wiki)
    except (SourceErrors, model.ModelError, texts.MissingText, stats.StatsError) as e:
        print(f"{type(e).__name__}: {len(e.errors)} error(s)", file=sys.stderr)
        for error in e.errors:
            print(error, file=sys.stderr)
        return 1
    except (sources.UnexpectedSource, ValueError, OSError) as e:
        print(f"{type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
