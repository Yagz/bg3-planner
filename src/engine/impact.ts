import type { GameData } from "../data/types.ts";
import type { Character, Choice, Run } from "../plan/model.ts";
import { activeParty, skillProficiencies, truncate } from "./coverage.ts";
import { grantedFeatures } from "./features.ts";
import type { Feature } from "./features.ts";
import type { Issue } from "./issues.ts";
import { resolve } from "./progression.ts";
import { levelSlots, slotIds, validate } from "./validate.ts";

/** A pick stored under a slot that no longer exists. */
export type RemovedPick = { level: number; slot: string; choice: Choice };

export type Impact = {
  gained: Feature[];
  lost: Feature[];
  slotsAdded: { level: number; slot: string }[];
  slotsRemoved: RemovedPick[];
  /** Invalid issues of `result` that `before` does not have (same code, level and slot). */
  newlyInvalid: Issue[];
  /** Skills the active party gains or loses proficiency in at level 12. */
  coverage: { gained: string[]; lost: string[] };
  /** `after` without its removed picks; every other choice is kept, even an impossible one. */
  result: Character;
};

/**
 * Per character level, every slot id a choice may be stored under, as `validate` decides it. A level whose class is
 * not a known base class is left out: `validate` checks no key there, so none of its picks is ever removed.
 */
export function openSlotIds(character: Character, data: GameData): Map<number, Set<string>> {
  const open = new Map<number, Set<string>>();
  for (const level of resolve(character, data).levels) {
    const slots = levelSlots(level, character.levels[level.level - 1]?.choices ?? {}, data);
    if (slots.checked) open.set(level.level, slotIds(slots));
  }
  return open;
}

/** Drops the choice keys of slots that no longer exist, and nothing else; the input is left untouched. */
export function pruneRemovedSlots(character: Character, data: GameData): { character: Character; removed: RemovedPick[] } {
  const open = openSlotIds(character, data);
  const removed: RemovedPick[] = [];
  const levels = character.levels.map((entry, i) => {
    const ids = open.get(i + 1);
    if (ids === undefined) return { ...entry, choices: { ...entry.choices } };
    const choices: Record<string, Choice> = {};
    for (const [slot, choice] of Object.entries(entry.choices)) {
      if (ids.has(slot)) choices[slot] = choice;
      else removed.push({ level: i + 1, slot, choice });
    }
    return { ...entry, choices };
  });
  return { character: { ...character, levels }, removed };
}

function features(character: Character, data: GameData): Feature[] {
  return resolve(character, data).levels.flatMap((level) => grantedFeatures(level, data));
}

/** Features of `a` that `b` lacks (compared by kind and identifier, whatever the level). */
function missingFrom(a: Feature[], b: Feature[]): Feature[] {
  const keys = new Set(b.map((f) => `${f.kind}:${f.id}`));
  return a.filter((f) => !keys.has(`${f.kind}:${f.id}`));
}

function partyProficiencies(run: Run, data: GameData): Set<string> {
  return new Set(activeParty(run).flatMap((character) => [...skillProficiencies(truncate(character, 12), data).proficient]));
}

/** Previews replacing `before` with `after`: what is gained and lost, which picks are removed, and what becomes invalid. */
export function impact(before: Character, after: Character, run: Run, data: GameData): Impact {
  const { character: result, removed } = pruneRemovedSlots(after, data);

  const beforeFeatures = features(before, data);
  const resultFeatures = features(result, data);

  const beforeSlots = openSlotIds(before, data);
  const slotsAdded: Impact["slotsAdded"] = [];
  for (const [level, ids] of openSlotIds(result, data)) {
    for (const slot of ids) if (!beforeSlots.get(level)?.has(slot)) slotsAdded.push({ level, slot });
  }

  const key = (issue: Issue) => JSON.stringify([issue.code, issue.level, issue.slot]);
  const invalid = (character: Character) => validate({ ...run, characters: [character] }, data).issues.filter((i) => i.severity === "invalid");
  const known = new Set(invalid(before).map(key));
  const newlyInvalid = invalid(result).filter((issue) => !known.has(key(issue)));

  const replaced = { ...run, characters: run.characters.map((c) => (c.id === before.id ? result : c)) };
  const was = partyProficiencies(run, data);
  const now = partyProficiencies(replaced, data);
  const coverage = {
    gained: Object.keys(data.skills).filter((skill) => now.has(skill) && !was.has(skill)),
    lost: Object.keys(data.skills).filter((skill) => was.has(skill) && !now.has(skill)),
  };

  return {
    gained: missingFrom(resultFeatures, beforeFeatures),
    lost: missingFrom(beforeFeatures, resultFeatures),
    slotsAdded,
    slotsRemoved: removed,
    newlyInvalid,
    coverage,
    result,
  };
}
