import type { GameData } from "../../../src/data/types.ts";
import { impact } from "../../../src/engine/impact.ts";
import type { Impact } from "../../../src/engine/impact.ts";
import { MAX_LEVELS } from "../../../src/plan/model.ts";
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

export function setAbilities(character: Character, base: Record<Ability, number>): Character {
  return { ...character, abilities: { ...base } };
}

/** Changes the class taken at a level; its picks stay where they are (those of slots that no longer exist are the preview's to list). */
export function setLevelClass(character: Character, level: number, cls: string | OffData): Character {
  return withLevel(character, level, (entry) => ({ ...entry, class: cls }));
}

/** Adds a level whose class is still to decide. */
export function addLevel(character: Character): Character {
  if (character.levels.length >= MAX_LEVELS) throw new Error(`The game stops at level ${MAX_LEVELS}`);
  return { ...character, levels: [...character.levels, { class: "", choices: {} }] };
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

/** Slots whose change may alter what the game grants: the subclass and the feat of a level. */
export function isPreviewedSlot(slot: string): boolean {
  return slot.startsWith("subclass:") || /^feat:\d+$/.test(slot);
}

/**
 * The impact of replacing `before` with `after` when it must be shown before applying: a feature gained or lost, a pick
 * under a slot that no longer exists, or a choice made impossible. Null when the change can apply directly. `run` must
 * still hold `before` (the engine computes the party's previous coverage from it).
 */
export function previewNeeded(before: Character, after: Character, run: Run, data: GameData): Impact | null {
  const preview = impact(before, after, run, data);
  const shown = preview.gained.length > 0 || preview.lost.length > 0 || preview.slotsRemoved.length > 0 || preview.newlyInvalid.length > 0;
  return shown ? preview : null;
}
