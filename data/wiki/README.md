# bg3.wiki item data

Data from bg3.wiki, https://bg3.wiki, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/); produced by `scripts/wiki/fetch.py`, do not edit by hand.

Modified: the wiki's equipment, weapons, item_locations and locations tables are joined by uid; identical rows merged; ambiguous uids and empty rows dropped; HTML entities decoded. The same notice and the licence URI are in `items.json` (`modified`, `license_url`).

`items.json` holds item rarity, legacy status and locations (with their act), keyed by the game's internal item identifier. The act of a location comes from joining the wiki's `item_locations` to `locations`; two places have no act in the wiki ("Creche Y'llek", "The Risen Road"). Six uids shared by several items are left out with their locations (`scripts/wiki/ambiguous_uids.txt`).

The fetcher uses bg3.wiki's `Special:CargoExport` (`cargoquery` is refused to anonymous clients), waits at least 5 seconds between requests, sends a generic User-Agent, and caches raw responses in `cache/wiki/` (git-ignored), reused unless `--refresh`. Never run it from the site.

Command: `python3.14 -m scripts.wiki.fetch --output data/wiki`

Fetched: 2026-11-23.
