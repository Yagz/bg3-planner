# Hand-written rules

Rules the game data cannot express, written by hand: each fact comes from bg3.wiki, https://bg3.wiki, licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), and every entry names its source page.

Rules for these files: entries are keyed by the game's internal identifiers (the names used in `data/larian/rules.json`), never by a displayed name; no game label is written here, names and descriptions come from the game's translation tables in `data/larian/`; each entry states its reason and its bg3.wiki source.

`unlocked_subclasses.json` lists the subclasses the game unlocks during play rather than at character creation, which no progression row offers (Oathbreaker, unlocked by breaking a Paladin's oath). `python3 -m scripts.data.checks data/larian` checks that each entry names a subclass of the given parent class and is offered by no progression row: an entry a patch makes stale is reported as an error.
