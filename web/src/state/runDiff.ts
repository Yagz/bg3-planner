import { ABILITIES, isOffData } from "../../../src/plan/model.ts";
import type { Character, Choice, OffData, Run } from "../../../src/plan/model.ts";
import { EQUIPMENT_SLOTS } from "../../../src/plan/equipmentSlots.ts";

export type ChangeKind =
  | "name"
  | "origin"
  | "partySize"
  | "difficulty"
  | "progress"
  | "party"
  | "characterAdded"
  | "characterRemoved"
  | "race"
  | "subrace"
  | "background"
  | "abilities"
  | "levelAdded"
  | "levelRemoved"
  | "levelClass"
  | "choice"
  | "notes"
  | "equipment"
  | "prepared";

/** What an equipment slot holds in an act when it holds no item of its own: emptied there, or taking the previous act's item. */
export type EquipmentState = "empty" | "inherited";

/**
 * One difference between two versions of a run. Values are identifiers (numbers as strings), never names.
 * `character` is the character's `who` ("player" or an origin id); `act` is set on a party change and on an act progress change.
 */
export type Change = {
  kind: ChangeKind;
  character?: string;
  level?: number;
  act?: "1" | "2" | "3";
  before?: string;
  after?: string;
  added?: string[];
  removed?: string[];
  /** On an equipment change: the slot's identifier; `before` / `after` are item ids, or absent when `beforeState` / `afterState` say why. */
  slot?: string;
  beforeState?: EquipmentState;
  afterState?: EquipmentState;
  /** On a prepared-spells change: the class of the level and the level's rank among that class's levels. */
  class?: string;
  classLevel?: number;
  /** On a prepared-spells change that switches between an own list and the inherited one; `added` / `removed` then hold the own list's content. */
  mode?: "own" | "inherited";
};

const ACTS = ["1", "2", "3"] as const;

/** A value that may be outside the game data, as text: the identifier, the text as written, or `""` for no value. */
function valueText(value: string | null | OffData): string {
  return value === null ? "" : isOffData(value) ? value.offData : value;
}

/** The picks of a choice: none for "todo" or when absent, the text as written for a value outside the game data. */
function picks(choice: Choice | undefined): string[] {
  if (choice === undefined || choice === "todo") return [];
  return isOffData(choice) ? [choice.offData] : Array.isArray(choice) ? choice.map(String) : [];
}

/** The entries of `a` left once each entry of `b` has removed one equal entry (a multiset difference, in `a`'s order). */
function without(a: string[], b: string[]): string[] {
  const left = [...b];
  return a.filter((entry) => {
    const at = left.indexOf(entry);
    if (at < 0) return true;
    left.splice(at, 1);
    return false;
  });
}

function sameSet(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((entry) => set.has(entry));
}

/** A change of one value between two texts; the side with no value is left out. */
function swap(kind: ChangeKind, before: string, after: string, extra: Partial<Change> = {}): Change {
  const change: Change = { kind, ...extra };
  if (before !== "") change.before = before;
  if (after !== "") change.after = after;
  return change;
}

/** The state of an equipment slot in one act: its item, `"empty"` when emptied there, `"inherited"` when the act holds no value for it. */
function slotState(character: Character, act: (typeof ACTS)[number], slot: string): string | EquipmentState {
  const value = (character.equipment[act] as Record<string, string | null> | undefined)?.[slot];
  return value === undefined ? "inherited" : value === null ? "empty" : value;
}

function equipmentChanges(before: Character, after: Character): Change[] {
  const changes: Change[] = [];
  for (const act of ACTS) {
    const keys = new Set([...Object.keys(before.equipment[act] ?? {}), ...Object.keys(after.equipment[act] ?? {})]);
    const slots = [...EQUIPMENT_SLOTS.filter((slot) => keys.has(slot)), ...[...keys].filter((slot) => !(EQUIPMENT_SLOTS as readonly string[]).includes(slot))];
    for (const slot of slots) {
      const was = slotState(before, act, slot);
      const now = slotState(after, act, slot);
      if (was === now) continue;
      const change: Change = { kind: "equipment", character: after.who, act, slot };
      if (was === "empty" || was === "inherited") change.beforeState = was;
      else change.before = was;
      if (now === "empty" || now === "inherited") change.afterState = now;
      else change.after = now;
      changes.push(change);
    }
  }
  return changes;
}

/** The rank of level `index` (0-based) among the levels of its class. */
function rankInClass(character: Character, index: number): number {
  const cls = valueText(character.levels[index]!.class);
  return character.levels.slice(0, index + 1).filter((level) => valueText(level.class) === cls).length;
}

function preparedChange(who: string, level: number, was: string[] | undefined, now: string[] | undefined, after: Character): Change | null {
  if (was === undefined && now === undefined) return null;
  const at = { class: valueText(after.levels[level - 1]!.class), classLevel: rankInClass(after, level - 1) };
  const base: Change = { kind: "prepared", character: who, level, ...at };
  if (was === undefined) return { ...base, mode: "own", added: [...now!], removed: [] };
  if (now === undefined) return { ...base, mode: "inherited", added: [], removed: [...was] };
  const added = without(now, was);
  const removed = without(was, now);
  return added.length === 0 && removed.length === 0 ? null : { ...base, added, removed };
}

function characterChanges(before: Character, after: Character): Change[] {
  const changes: Change[] = [];
  const who = after.who;
  for (const field of ["race", "subrace", "background"] as const) {
    const a = valueText(before[field]);
    const b = valueText(after[field]);
    if (a !== b) changes.push({ kind: field, character: who, before: a, after: b });
  }
  const scores = (character: Character) => ABILITIES.map((ability) => character.abilities[ability]).join("/");
  if (scores(before) !== scores(after)) changes.push({ kind: "abilities", character: who, before: scores(before), after: scores(after) });
  if (before.notes !== after.notes) changes.push({ kind: "notes", character: who });
  changes.push(...equipmentChanges(before, after));
  const common = Math.min(before.levels.length, after.levels.length);
  for (let i = 0; i < common; i++) {
    const was = before.levels[i]!;
    const now = after.levels[i]!;
    const level = i + 1;
    if (valueText(was.class) !== valueText(now.class)) {
      changes.push({ kind: "levelClass", character: who, level, before: valueText(was.class), after: valueText(now.class) });
    }
    const prepared = preparedChange(who, level, was.prepared, now.prepared, after);
    if (prepared !== null) changes.push(prepared);
    const slots = [...new Set([...Object.keys(was.choices), ...Object.keys(now.choices)])];
    for (const slot of slots) {
      const a = picks(was.choices[slot]);
      const b = picks(now.choices[slot]);
      if (a.length === b.length && a.every((entry, i) => entry === b[i])) continue;
      let removed = without(a, b);
      let added = without(b, a);
      if (removed.length === 0 && added.length === 0) {
        // The same picks in another order: compared position by position.
        removed = a.filter((entry, i) => b[i] !== entry);
        added = b.filter((entry, i) => a[i] !== entry);
      }
      changes.push(
        added.length <= 1 && removed.length <= 1
          ? swap("choice", removed[0] ?? "", added[0] ?? "", { character: who, level })
          : { kind: "choice", character: who, level, added, removed },
      );
    }
  }
  for (let level = common + 1; level <= after.levels.length; level++) changes.push({ kind: "levelAdded", character: who, level });
  for (let level = common + 1; level <= before.levels.length; level++) changes.push({ kind: "levelRemoved", character: who, level });
  return changes;
}

/**
 * What `after` changes compared with `before`, in run order: run fields, the party of each act, then the characters in run order
 * (levels ascending). `before` null (the oldest saved version) gives no change. Never throws on any choice shape.
 */
export function runDiff(before: Run | null, after: Run): Change[] {
  if (before === null) return [];
  const changes: Change[] = [];
  if (before.name !== after.name) changes.push({ kind: "name", before: before.name, after: after.name });
  if (before.origin !== after.origin) changes.push({ kind: "origin", before: before.origin, after: after.origin });
  if (before.partySize !== after.partySize) changes.push({ kind: "partySize", before: String(before.partySize), after: String(after.partySize) });
  if (before.difficulty.ruleset !== after.difficulty.ruleset) {
    changes.push({ kind: "difficulty", before: before.difficulty.ruleset, after: after.difficulty.ruleset });
  } else if (JSON.stringify(before.difficulty.overrides) !== JSON.stringify(after.difficulty.overrides)) {
    changes.push({ kind: "difficulty" });
  }
  if (before.progress.level !== after.progress.level) {
    changes.push({ kind: "progress", level: after.progress.level, before: String(before.progress.level), after: String(after.progress.level) });
  }
  if (before.progress.act !== after.progress.act) {
    changes.push({ kind: "progress", act: String(after.progress.act) as "1" | "2" | "3", before: String(before.progress.act), after: String(after.progress.act) });
  }
  if (before.notes !== after.notes) changes.push({ kind: "notes" });
  for (const act of ACTS) {
    const a = before.party[act].active;
    const b = after.party[act].active;
    if (sameSet(a, b)) continue;
    changes.push({ kind: "party", act, added: b.filter((id) => !a.includes(id)), removed: a.filter((id) => !b.includes(id)) });
  }
  const earlier = new Map(before.characters.map((character) => [character.id, character]));
  const later = new Set(after.characters.map((character) => character.id));
  for (const character of after.characters) {
    const was = earlier.get(character.id);
    if (was === undefined) changes.push({ kind: "characterAdded", character: character.who });
    else changes.push(...characterChanges(was, character));
  }
  for (const character of before.characters) if (!later.has(character.id)) changes.push({ kind: "characterRemoved", character: character.who });
  return changes;
}

/** True when the two runs differ in anything but their edit date, whether or not `runDiff` reports it (equipment, decisions, bonuses, party status…). */
export function differsAtAll(before: Run, after: Run): boolean {
  return JSON.stringify({ ...before, updatedAt: null }) !== JSON.stringify({ ...after, updatedAt: null });
}
