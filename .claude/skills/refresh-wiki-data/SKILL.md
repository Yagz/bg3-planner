---
name: refresh-wiki-data
description: Refresh data/wiki/items.json (item rarity, legacy status and locations with their act) from bg3.wiki's Cargo exports. Use when the wiki data is stale, before re-importing items, or when someone asks for new wiki-sourced fields (e.g. page links).
---

# Refresh the bg3.wiki data

bg3.wiki rate-limits bots. The fetch is one-off, slow and polite, and the site never calls the wiki. Data is CC BY-NC-SA 4.0: keep the attribution and the modification notice (`data/wiki/README.md`, top-level keys of `items.json`).

## Facts

- `api.php?action=cargoquery` is refused to anonymous clients; `index.php?title=Special:CargoExport&tables=…&fields=…&format=json&limit=…&offset=…` works.
- Tables used: `equipment`, `weapons` (`uid` = a game stats name or a RootTemplate name, `uuid` = the RootTemplate), `item_locations`, `locations` (gives the act). Field lists: `api.php?action=cargofields&table=<t>&format=json`.
- Export strings are HTML-escaped (decoded by the fetcher). Some uids are shared by several wiki items: listed in `scripts/wiki/ambiguous_uids.txt` and left out.

## Steps

1. `python3.14 -m scripts.wiki.fetch --output data/wiki` reuses `cache/wiki/` (git-ignored); add `--refresh` to call the wiki again (at least 5 s between requests, generic User-Agent, no personal data).
2. On build errors (new ambiguous uids, duplicate locations, unknown acts): group them and **ask the maintainer** before listing anything.
3. Update the fetch date in `data/wiki/README.md`, then re-import the game data (skill `import-game-data`) since the item scope comes from this file, and run `python3.14 -m scripts.data.checks data/larian`.
4. Commit the wiki data on its own, in English.
