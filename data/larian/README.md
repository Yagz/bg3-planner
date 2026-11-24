# data/larian — game data (generated)

**Generated — do not edit by hand.** Every file in this folder except this README is written by the import command from the installed game's files, read-only.

> Non-commercial fan project; content owned by Larian Studios.

## Provenance

- Game: Baldur's Gate 3, version 4.1.1.7631656 (patch 8); the exact version is also in `meta.json`.
- Rules: the LSX and stats files of the `Shared.pak`, `Gustav.pak` and `GustavX.pak` paks, modules `Shared`, `SharedDev`, `Gustav`, `GustavDev`, `GustavX` in that override order. Mod paks and Honour mode modules are ignored; a hotfix pak (`Data/Patch*.pak`) that touches rules files stops the import.
- Items: the scope is the obtainable items (`legacy` null) of `data/wiki/items.json` (bg3.wiki, CC BY-NC-SA 4.0), minus `scripts/data/items_excluded.txt`; each is looked up in the item stats (`Armor.txt`, `Weapon.txt`) by its identifier, its stats entry's `RootTemplate` giving its template; failing that, as the `Name` of the RootTemplate (`RootTemplates/_merged.lsf` of the same modules) given by its wiki `uuid`, that template's `Stats` giving its stats entry. Its name and description come from that template. `scripts/data/lsf.py` reads the binary LSF templates (ported from LSLib, MIT) and `scripts/data/templates.py` applies overrides and `ParentTemplateId` inheritance across the modules. Real counts at import: 1368 wiki items, 744 with locations, 1167 items imported (519 found by stats, 648 by template).
- Texts: the English and French translation tables (`Localization/English.pak`, `Localization/French/French.pak`). Texts are kept raw (markup and parameters included).

## Files

- `meta.json`: game version, modules read, and the ownership notice in English and French (shown by the app in each language).
- `rules.json`: classes and subclasses, playable races, backgrounds, feats, progressions, the lists they reference, spells and passives (with their boosts), and the key items (`kind`, `found_by` — `stats` or `template`, the lookup that found the item —, `stats_type`, `slot`, `rarity`, `root_template`). `spells.*.level` is `null` when the game's stats give the spell no `Level`; an item's `slot` or `rarity` is `null` when its stats entry has none.
- `texts.en.json`, `texts.fr.json`: name and description of every element, keyed `<category>:<identifier>`.

## Command

```
python3.14 -m scripts.data.importer --game <game install directory> --game-version <version> --output data/larian
```

`--game` defaults to `$BG3_GAME`; `--wiki` (the bg3.wiki item file) defaults to `data/wiki/items.json`. The import fails, writing nothing, on any duplicate identifier, orphan reference or missing text, and prints the complete list.

Five committed lists, each entry with its reason, describe the exceptions found in the source data (the game's files, or the bg3.wiki items for `items_excluded.txt` and `ambiguous_uids.txt`); an entry that no longer matches the data is an error, so each list stays exact:

- `scripts/data/unnamed.txt`: identifiers deliberately left without a name; a line `<identifier> description` instead keeps the name (required in both languages) and leaves the description knowingly missing (`null` in both text tables).
- `scripts/data/game_typos.txt`: typos in the game's own progression or feat selectors, each corrected before parsing, only on an exact match of the raw segment. Nothing else is ever corrected.
- `scripts/data/items_excluded.txt`: 57 obtainable bg3.wiki items kept out of the imported items because neither lookup finds them in the game data, or because the wiki and the game disagree on them; an entry that is not an obtainable wiki item, or that now resolves without error, is an error. Four groups: 39 whose wiki uuid is not a RootTemplate (36 of them named `S_*`, likely placed level objects); 11 whose wiki uuid's RootTemplate has another `Name`; 1 whose template `Stats` is neither armour nor weapon; 6 found by stats name whose wiki uuid differs from the stats entry's RootTemplate.
- `scripts/wiki/ambiguous_uids.txt`: the 6 wiki uids shared by several different items, left out of `data/wiki/items.json` together with their locations because a location cannot be attributed by uid; a listed uid that is no longer ambiguous is an error.
- `scripts/data/known_duplicates.txt`: groups of progressions that share the same table, level and multiclass flag in the game itself. They are kept unchanged in `rules.json`; the rules engine applies every row of a group and counts a selector identical to one of an earlier row once (the rule and its bg3.wiki sources are stated in that file).

`python3.14 -m scripts.data.checks data/larian` checks the committed data without the game (references, texts, counts, selectors, duplicates, items against the wiki scope).
