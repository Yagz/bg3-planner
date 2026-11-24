# BG3 Planner

Party planner for Baldur's Gate 3: party, level-by-level builds for your character and companions, key items, run decisions. The app will be available in English and French.

## Status

In development. The game-data import (character creation and progression rules, and key items with their acts, with English and French names) is done; the rules engine and the interface come next.

## Development

Requirements: Python 3.14 (standard library only) for the data scripts; Node 24 (not 26, which breaks Vitest) for the rules engine and the web app.

- Run the tests: `python3.14 -m unittest discover -s tests -t .`
- Install the Node dev dependencies: `npm ci`; type-check: `npx tsc --noEmit`; run the TypeScript tests: `npx vitest run`
- Read, edit and validate a run string (a string, a file or `-` for stdin): `node scripts/run.ts decode <run>` (readable JSON), `node scripts/run.ts encode <file.json>` (export string), `node scripts/run.ts validate <run> [--lang en|fr]` (exit 0 valid, 1 incomplete, 2 invalid, 3 unreadable input), `node scripts/run.ts slots <run> <character id>` (open choice slots with the allowed identifiers)
- Check the committed game data: `python3.14 -m scripts.data.checks data/larian`
- Refresh the bg3.wiki item data (slow, polite, cached in `cache/wiki/`): `python3.14 -m scripts.wiki.fetch --output data/wiki` — see [`data/wiki/README.md`](data/wiki/README.md).
- Re-import the game data from an installed copy of the game (read-only): `python3.14 -m scripts.data.importer --game <game install directory> --game-version <version>` — see [`data/larian/README.md`](data/larian/README.md).

Project rules for contributors are in [`CLAUDE.md`](CLAUDE.md).

## License

Code licensed under the GNU GPL v3 or later, see [`LICENSE`](LICENSE). Data has its own terms, below.

## Data

- Game names and descriptions are the property of Larian Studios; this is a free, non-commercial fan project.
- Item rarity, legacy status and locations (with their act) come from [bg3.wiki](https://bg3.wiki), under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), in `data/wiki/`. They are fetched once by script and shipped with the site; the wiki is never called from the app. Modified: the wiki's equipment, weapons, item_locations and locations tables are joined by uid; identical rows merged; ambiguous uids and empty rows dropped; HTML entities decoded.
- `scripts/data/lsf.py` is a port of parts of LSLib (MIT), see [`THIRD_PARTY.md`](THIRD_PARTY.md).

Baldur's Gate 3 is a trademark of Larian Studios. Not affiliated with Larian Studios or Wizards of the Coast.
