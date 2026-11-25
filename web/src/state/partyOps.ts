import type { GameData } from "../../../src/data/types.ts";
import { MAX_LEVELS } from "../../../src/plan/model.ts";
import type { Character, PartyStatus, Run } from "../../../src/plan/model.ts";

export type Act = 1 | 2 | 3;
export const ACTS: Act[] = [1, 2, 3];
export const STATUSES: PartyStatus[] = ["core", "alternative", "bench"];

const key = (act: Act): "1" | "2" | "3" => String(act) as "1" | "2" | "3";

/** The base scores of a character nobody has built yet. */
const DEFAULT_SCORES = { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 };

function blank(): Character {
  return { id: crypto.randomUUID(), who: "player", race: "", subrace: null, background: "", abilities: { ...DEFAULT_SCORES }, levels: [{ class: "", choices: {} }], items: [], notes: "" };
}

/** Whether a companion origin can be added: it names a class (`Generic` does not). */
export function isRecruitable(data: GameData, origin: string): boolean {
  return Object.hasOwn(data.rules.origins, origin) && data.rules.origins[origin]?.class != null;
}

/**
 * Adds a character without filling any choice. `who` is "player" or an origin name: a companion gets its origin's race,
 * subrace, background, class at level 1 and preset base scores (its subclass stays to decide); the player is empty, or
 * takes the fixed fields of the run's origin when that origin locks its race. Throws on an unknown origin or a character already present.
 */
export function addCharacter(run: Run, data: GameData, who: string): Run {
  if (run.characters.some((character) => character.who === who)) throw new Error(`${who} is already in the run`);
  const character = blank();
  character.who = who;
  const originName = who === "player" ? run.origin : who;
  if (who !== "player" && !Object.hasOwn(data.rules.origins, who)) throw new Error(`Unknown origin: ${who}`);
  const origin = Object.hasOwn(data.rules.origins, originName) ? data.rules.origins[originName] : undefined;
  if (origin !== undefined && (who !== "player" || origin.lockRace)) {
    character.race = origin.race ?? "";
    character.subrace = origin.subrace;
    character.background = origin.background ?? "";
    character.levels = [{ class: origin.class ?? "", choices: {} }];
    if (origin.abilities !== null) character.abilities = { ...origin.abilities };
  }
  return { ...run, characters: [...run.characters, character] };
}

/**
 * Bounds of the party size. The run format sets none; 1 to 8 covers the game's default of 4 and the larger parties
 * players reach with mods.
 */
export const PARTY_SIZE = { min: 1, max: 8 };

/** Changes the party size; an active party over the new size is kept as it is (see `overFullActs`), never trimmed. */
export function setPartySize(run: Run, size: number): Run {
  if (!Number.isInteger(size) || size < PARTY_SIZE.min || size > PARTY_SIZE.max) throw new Error(`The party size must be between ${PARTY_SIZE.min} and ${PARTY_SIZE.max}`);
  return { ...run, partySize: size };
}

/** The acts whose active party has more members than the party size (after the size was lowered). */
export function overFullActs(run: Run): Act[] {
  return ACTS.filter((act) => run.party[key(act)].active.length > run.partySize);
}

/**
 * Sets the active party of an act, in order. Throws on growing it past `partySize` (an act already over the size may
 * still lose members), an unknown character or a duplicate.
 */
export function setActive(run: Run, act: Act, ids: string[]): Run {
  if (ids.length > run.partySize && ids.length >= run.party[key(act)].active.length) throw new Error(`An active party holds at most ${run.partySize} members`);
  if (new Set(ids).size !== ids.length) throw new Error("A character cannot be active twice");
  for (const id of ids) if (!run.characters.some((character) => character.id === id)) throw new Error(`Unknown character: ${id}`);
  const party = run.party[key(act)];
  return { ...run, party: { ...run.party, [key(act)]: { ...party, active: [...ids] } } };
}

export function setStatus(run: Run, act: Act, id: string, status: PartyStatus): Run {
  if (!run.characters.some((character) => character.id === id)) throw new Error(`Unknown character: ${id}`);
  const party = run.party[key(act)];
  return { ...run, party: { ...run.party, [key(act)]: { ...party, status: { ...party.status, [id]: status } } } };
}

/** Replaces the party of act 2 or 3 with a copy of the previous act's (members and statuses). Only called on a user action. */
export function copyPartyFromPreviousAct(run: Run, act: Act): Run {
  if (act === 1) throw new Error("Act 1 has no previous act");
  const previous = run.party[key((act - 1) as Act)];
  return { ...run, party: { ...run.party, [key(act)]: { active: [...previous.active], status: { ...previous.status } } } };
}

export function setProgress(run: Run, level: number, act: Act): Run {
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVELS) throw new Error(`Level must be between 1 and ${MAX_LEVELS}`);
  if (!ACTS.includes(act)) throw new Error(`Act must be 1, 2 or 3`);
  return { ...run, progress: { level, act } };
}
