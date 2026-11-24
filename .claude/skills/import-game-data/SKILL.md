---
name: import-game-data
description: Re-import data/larian/ (rules, items, English and French texts) from an installed copy of Baldur's Gate 3, e.g. after a game patch. Use when the game version changes, when the import or the data checks fail, or when someone asks to refresh the game data.
---

# Re-import the game data

The import reads the installed game read-only and rewrites `data/larian/`. It never corrects the game data silently: every exception it accepts is listed, with its reason, in a committed file, and a listed entry that no longer matches is an error. Details: `data/larian/README.md`.

## Before

- Python 3.14, standard library only. The game install path and version are machine-specific: ask the maintainer or read `CLAUDE.local.md`; never write them in the repository.
- `data/wiki/items.json` must be up to date first if items changed (see the `refresh-wiki-data` skill): the importer takes the item scope from it.
- Work on a branch.

## Steps

1. Run the tests: `python3.14 -m unittest discover -s tests -t .`
2. Import: `python3.14 -m scripts.data.importer --game "<game install directory>" --game-version <version>` (about 30 s). On failure it prints every error and writes nothing.
3. If it fails with data exceptions (missing texts, items not found, duplicate progressions, typos in selectors, stale list entries…):
   - Group the errors by pattern with counts and examples.
   - **Stop and ask the maintainer** which ones to list. Never add entries to `scripts/data/unnamed.txt`, `items_excluded.txt`, `game_typos.txt`, `known_duplicates.txt`, `scripts/wiki/ambiguous_uids.txt` or `data/rules/unlocked_subclasses.json` on your own: these are decisions. An unlocked subclass that a progression row now offers is reported as stale by the checks.
   - Check suspicious values against the game before blaming the code (e.g. read the RootTemplate chain with `scripts.data.templates`, resolve handles with the translation tables).
4. Run the import a second time: `git status --short data/larian` must show no change (determinism).
5. Check the committed data without the game: `python3.14 -m scripts.data.checks data/larian` (must print nothing). If counts changed legitimately (new patch), update `COUNTS` in `scripts/data/checks.py` and say why in the commit.
6. Commit code changes and data separately, in English, stating what the change establishes.

## Pitfalls already met

- Stats values can span several lines; list separators differ per file (`;` or `,`); the game has duplicate progression nodes and typos (`AlwaysPrepared)`); some English texts are Larian placeholders (`%%%…`) or the unknown-handle marker `ls::TranslatedStringRepository::s_HandleUnknown`.
- `Data/` also holds mod paks: only the base paks are read, in the module order of `scripts/data/sources.py`; a `Patch*.pak` that touches rules files stops the import.
