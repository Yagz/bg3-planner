import type { GameData } from "../../../src/data/types.ts";
import { impact } from "../../../src/engine/impact.ts";
import type { Impact } from "../../../src/engine/impact.ts";
import { MAX_LEVELS, isOffData } from "../../../src/plan/model.ts";
import type { Ability, Character, Choice, OffData, Run } from "../../../src/plan/model.ts";

// Pure operations on a character. Levels are 1-based, like the engine's slots. None of them fills a choice.

function levelIndex(character: Character, level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > character.levels.length) throw new Error(`No level ${level} for this character`);
  return level - 1;
}

function withLevel(character: Character, level: number, edit: (entry: Character["levels"][number]) => Character["levels"][number]): Character {
  const index = levelIndex(character, level);
  return { ...character, levels: character.levels.map((entry, i) => (i === index ? edit(entry) : entry)) };
}

/** Stores the picks of one slot; every other slot is left as it is. */
export function setChoice(character: Character, level: number, slot: string, choice: Choice): Character {
  return withLevel(character, level, (entry) => ({ ...entry, choices: { ...entry.choices, [slot]: choice } }));
}

/** Removes the picks of one slot: the choice is to decide again (or, for an optional slot, left unmade). */
export function clearChoice(character: Character, level: number, slot: string): Character {
  return withLevel(character, level, (entry) => {
    const choices = { ...entry.choices };
    delete choices[slot];
    return { ...entry, choices };
  });
}

/** Changes one identity field and nothing else (a subrace left from another race is the engine's to flag). Only the subrace may be null. */
export function setIdentity(character: Character, field: "race" | "subrace" | "background", value: string | OffData | null): Character {
  if (value === null && field !== "subrace") throw new Error(`The ${field} cannot be empty`);
  return { ...character, [field]: value };
}

/**
 * The player under run origin `origin`: an origin that locks its race takes its race, subrace and background (nothing
 * else: class, levels and scores stay as they are); the custom player (`""`) or an origin that locks nothing changes nothing.
 */
export function withOriginLock(character: Character, data: GameData, origin: string): Character {
  const def = Object.hasOwn(data.rules.origins, origin) ? data.rules.origins[origin] : undefined;
  if (def === undefined || !def.lockRace) return character;
  return { ...character, race: def.race ?? "", subrace: def.subrace, background: def.background ?? "" };
}

export function setAbilities(character: Character, base: Record<Ability, number>): Character {
  return { ...character, abilities: { ...base } };
}

/** Changes the class taken at a level; its picks stay where they are (those of slots that no longer exist are the preview's to list). */
export function setLevelClass(character: Character, level: number, cls: string | OffData): Character {
  return withLevel(character, level, (entry) => ({ ...entry, class: cls }));
}

/**
 * Adds a level that continues the last level's class as it is (a class, `""` still to decide, or a value outside the
 * game data), with no picks.
 */
export function addLevel(character: Character): Character {
  if (character.levels.length >= MAX_LEVELS) throw new Error(`The game stops at level ${MAX_LEVELS}`);
  const last = character.levels.at(-1)?.class ?? "";
  return { ...character, levels: [...character.levels, { class: isOffData(last) ? { ...last } : last, choices: {} }] };
}

/** Removes the last level and its picks; a character keeps at least one level. */
export function removeLastLevel(character: Character): Character {
  if (character.levels.length <= 1) throw new Error("A character keeps at least one level");
  return { ...character, levels: character.levels.slice(0, -1) };
}

/** The run with `character` in place of the character of the same id. */
export function replaceCharacter(run: Run, character: Character): Run {
  if (!run.characters.some((c) => c.id === character.id)) throw new Error(`Unknown character: ${character.id}`);
  return { ...run, characters: run.characters.map((c) => (c.id === character.id ? character : c)) };
}

/** Where `after` differs from `before` (creation is level 0), and whether any of those places held a choice already made. */
function changes(before: Character, after: Character): { edited: Set<string>; first: number; replacesMade: boolean } {
  const edited = new Set<string>();
  let replacesMade = false;
  const differs = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const made = (value: unknown) => value !== undefined && value !== null && value !== "" && value !== "todo";
  for (const field of ["race", "subrace", "background"] as const) {
    if (!differs(before[field], after[field])) continue;
    edited.add(`0|${field}`);
    if (made(before[field])) replacesMade = true;
  }
  if (differs(before.abilities, after.abilities)) edited.add("0|abilities");
  for (let i = 0; i < Math.max(before.levels.length, after.levels.length); i++) {
    const level = i + 1;
    const was = before.levels[i];
    const now = after.levels[i];
    if (differs(was?.class, now?.class)) {
      edited.add(`${level}|class`);
      if (made(was?.class)) replacesMade = true;
    }
    for (const slot of new Set([...Object.keys(was?.choices ?? {}), ...Object.keys(now?.choices ?? {})])) {
      const old = was !== undefined && Object.hasOwn(was.choices, slot) ? was.choices[slot] : undefined;
      const updated = now !== undefined && Object.hasOwn(now.choices, slot) ? now.choices[slot] : undefined;
      if (!differs(old, updated)) continue;
      edited.add(`${level}|${slot}`);
      if (made(old)) replacesMade = true;
    }
  }
  const first = Math.min(...[...edited].map((key) => Number(key.slice(0, key.indexOf("|")))));
  return { edited, first, replacesMade };
}

/**
 * The impact of replacing `before` with `after` when it must be shown before applying (null when the change applies
 * directly): a pick removed; a feature gained or lost by replacing a choice already made (a first pick applies
 * directly); or a choice at a later level than the change made newly invalid (issues at the edited places themselves,
 * such as the point-buy budget while stepping a score, never open it). `run` must still hold `before` (the engine
 * computes the party's previous coverage from it).
 */
export function previewNeeded(before: Character, after: Character, run: Run, data: GameData): Impact | null {
  const preview = impact(before, after, run, data);
  const { edited, first, replacesMade } = changes(before, after);
  const laterInvalid = preview.newlyInvalid.some((issue) => issue.level !== null && issue.level > first && !edited.has(`${issue.level}|${issue.slot}`));
  const shown = preview.slotsRemoved.length > 0 || laterInvalid || (replacesMade && (preview.gained.length > 0 || preview.lost.length > 0));
  return shown ? preview : null;
}
