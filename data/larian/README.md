# data/larian — game data (generated)

**Generated — do not edit by hand.** Every file in this folder except this README is written by the import command from the installed game's files, read-only.

> Non-commercial fan project; content owned by Larian Studios.

## Provenance

- Game: Baldur's Gate 3, version 4.1.1.7631656 (patch 8); the exact version is also in `meta.json`.
- Rules: the LSX and stats files of the `Shared.pak`, `Gustav.pak` and `GustavX.pak` paks, modules `Shared`, `SharedDev`, `Gustav`, `GustavDev`, `GustavX` in that override order. Mod paks and Honour mode modules are ignored; a hotfix pak (`Data/Patch*.pak`) that touches rules files stops the import.
- Texts: the English and French translation tables (`Localization/English.pak`, `Localization/French/French.pak`). Texts are kept raw (markup and parameters included).

## Files

- `meta.json`: game version, modules read, and the ownership notice in English and French (shown by the app in each language).
- `rules.json`: classes and subclasses, playable races, backgrounds, feats, progressions, the lists they reference, spells and passives (with their boosts). `spells.*.level` is `null` when the game's stats give the spell no `Level`.
- `texts.en.json`, `texts.fr.json`: name and description of every element, keyed `<category>:<identifier>`.

## Command

```
python3.14 -m scripts.data.importer --game <game install directory> --game-version <version> --output data/larian
```

`--game` defaults to `$BG3_GAME`. The import fails, writing nothing, on any duplicate identifier, orphan reference or missing text, and prints the complete list.

Three committed lists, each entry with its reason, describe the exceptions found in the game itself; an entry that no longer matches the game data is an error, so each list stays exact:

- `scripts/data/unnamed.txt`: identifiers deliberately left without a name.
- `scripts/data/game_typos.txt`: typos in the game's own progression or feat selectors, each corrected before parsing, only on an exact match of the raw segment. Nothing else is ever corrected.
- `scripts/data/known_duplicates.txt`: groups of progressions that share the same table, level and multiclass flag in the game itself. They are kept unchanged in `rules.json`; which node the game applies is not settled here.

`python3.14 -m scripts.data.checks data/larian` checks the committed data without the game (references, texts, counts, selectors, duplicates).
