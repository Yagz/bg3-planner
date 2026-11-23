# BG3 Planner

Party planner for Baldur's Gate 3: party, level-by-level builds for your character and companions, key items, run decisions. The app will be available in English and French.

## Status

In development. The game-data import (character creation and progression rules, with English and French names) is done; the rules engine and the interface come next.

## Development

Requirements: Python 3.14 (standard library only) for the data scripts; Node 24 for the web app (to come).

- Run the tests: `python3.14 -m unittest discover -s tests -t .`
- Check the committed game data: `python3.14 -m scripts.data.checks data/larian`
- Re-import the game data from an installed copy of the game (read-only): `python3.14 -m scripts.data.importer --game <game install directory> --game-version <version>` — see [`data/larian/README.md`](data/larian/README.md).

Project rules for contributors are in [`CLAUDE.md`](CLAUDE.md).

## License

Code licensed under the GNU GPL v3 or later, see [`LICENSE`](LICENSE). Data has its own terms, below.

## Data

- Game names and descriptions are the property of Larian Studios; this is a free, non-commercial fan project.
- Item locations will come from [bg3.wiki](https://bg3.wiki), under CC BY-NC-SA 4.0.

Baldur's Gate 3 is a trademark of Larian Studios. Not affiliated with Larian Studios or Wizards of the Coast.
