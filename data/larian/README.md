# data/larian — game data (generated)

**Generated — do not edit by hand.** Every file in this folder except this README is written by the import command from the installed game's files, read-only.

> Projet de fans non commercial ; contenu propriété de Larian Studios.
>
> Non-commercial fan project; content owned by Larian Studios.

## Provenance

- Game: Baldur's Gate 3, version 4.1.1.7631656 (patch 8); the exact version is also in `meta.json`.
- Rules: the LSX and stats files of the `Shared.pak`, `Gustav.pak` and `GustavX.pak` paks, modules `Shared`, `SharedDev`, `Gustav`, `GustavDev`, `GustavX` in that override order. Mod paks and Honour mode modules are ignored; a hotfix pak that touches rules files stops the import.
- Texts: the English and French translation tables (`Localization/English.pak`, `Localization/French/French.pak`). Texts are kept raw (markup and parameters included).

## Files

- `meta.json`: game version, modules read, bilingual notice.
- `rules.json`: classes and subclasses, playable races, backgrounds, feats, progressions, the lists they reference, spells and passives.
- `texts.en.json`, `texts.fr.json`: name and description of every element, keyed `<category>:<identifier>`.

## Command

```
python3.14 -m scripts.data.importer --game <game install directory> --game-version <version> --output data/larian
```

`--game` defaults to `$BG3_GAME`. Identifiers deliberately left without a name are listed in `scripts/data/unnamed.txt`. The import fails, writing nothing, on any duplicate identifier, orphan reference or missing text, and prints the complete list.
