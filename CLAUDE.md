# BG3 Planner — project instructions

A party planner for Baldur's Gate 3, bilingual (English, French), built as a static web app published on GitHub Pages. The design document, maintainer-local and not versioned, is `docs/superpowers/specs/2026-11-23-bg3-planner-design.md` (in French): when it is present, read it before any work and do not reopen a decision it records without the maintainer's agreement. The rules below are the parts of it every contributor must follow.

Machine-specific context (game paths, local tools, working rules, state of the previous session) lives in `CLAUDE.local.md`, which is not versioned.

## Non-negotiable principles

- **Everything is keyed by the game's internal identifier** (`Target_BurstingSinew`, `MAG_Acrobat_Shoes`…). Displayed names are translations of that identifier, never keys.
- **No hand-written game label**: names and descriptions come from the game's English and French translation tables, produced by the import scripts.
- **No resource loaded from another site** once the page is served: fonts, scripts, styles, images and data ship with the site. A build-time check enforces it.
- **No server**: state lives in the browser; the export string (versioned prefix, compressed JSON, URL-safe base64) is the only durable save and must stay readable from one version to the next.
- **An import never corrects silently**: every choice the rules engine refuses is listed. The same holds for the data import: an exception found in the game itself is accepted only when listed, with its reason, in a committed file.
- **Saves and game files are read, never written.**

## Data and licences

- Code: GPL-3.0-or-later (`LICENSE`). Code taken from another project must have a compatible licence (MIT, BSD, GPL-3.0…) and keep its origin notice; a project without a licence may be read, not copied.
- `data/larian/`: produced by script from the game files, never edited by hand; content owned by Larian Studios, non-commercial fan project. See `data/larian/README.md`.
- `data/wiki/`: produced by script from bg3.wiki (Cargo tables), CC BY-NC-SA 4.0, attribution required. bg3.wiki strongly limits bots: one-off, slow extraction, never from the site.
- `data/rules/`: hand-written, bilingual (companions, story alerts, unique bonuses), facts sourced from bg3.wiki, labels taken from the translation tables.

## Data workflows

- Re-import the game data after a patch: skill `.claude/skills/import-game-data`. Refresh the bg3.wiki data: skill `.claude/skills/refresh-wiki-data`.
- Data exceptions (texts left unnamed, excluded items, ambiguous wiki uids, game typos, duplicate progressions) are decisions for the maintainer: present the grouped list, never add entries to the exception lists on your own.

## Working on a run string

- Read it with `node scripts/run.ts decode <run>` (readable JSON; the `_names` fields are display hints and are ignored on import), change identifiers only, check with `node scripts/run.ts validate <file>`, then `node scripts/run.ts encode <file.json>`.
- `node scripts/run.ts slots <run> <character id>` lists the open choices with the identifiers the game allows; use it instead of guessing identifiers.
- Never complete a build's game decisions (subclass, spells, feats, skills) unless the user asks: `incomplete` (exit 1, a choice still `"todo"`) is a normal state, `invalid` (exit 2, an impossible choice) is a defect to report, not to correct silently.

## Conventions

- **Everything public is in English**: code (identifiers, comments, docstrings, tests, error messages, keys of produced JSON, folder names), documentation and commit messages. French appears only as product content (French game texts, the French UI and notices). Maintainer-local material (`docs/`, `CLAUDE.local.md`) may be in French and is not versioned.
- A commit message states what the change establishes, not which files it touches.
- No hard line wrapping in text files (Markdown included).
- Never a session URL or an internal tool identifier in a commit, a PR or an issue.
- Node 24 (Node 26 breaks Vitest); Python 3.14 for the data scripts, standard library only.
