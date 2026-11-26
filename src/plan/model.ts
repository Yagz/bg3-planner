import type { Act, EquipmentSlot } from "./equipmentSlots.ts";

export const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
export type Ability = (typeof ABILITIES)[number];

export const MAX_LEVELS = 12;

/** A value outside the game data (e.g. from a mod), kept as written and never interpreted. */
export type OffData = { offData: string };

export function isOffData(value: unknown): value is OffData {
  return typeof value === "object" && value !== null && !Array.isArray(value) && typeof (value as OffData).offData === "string";
}

/** The picks made at one slot: identifiers, not decided yet, or a value outside the game data. */
export type Choice = string[] | "todo" | OffData;

export type Level = {
  /** The class taken at this level. */
  class: string | OffData;
  /** Choices by slot id (`<progression UUID>/<selector index>`). */
  choices: Record<string, Choice>;
  /**
   * The spells prepared for this level's class from this level on; absent, the list of the class's previous level holds.
   * An empty list is an explicit list.
   */
  prepared?: string[];
};

/**
 * Per act, slot → item id, or null for a slot emptied on purpose. A slot absent from an act keeps the previous act's item.
 * The codec accepts any slot key; the engine judges it.
 */
export type Equipment = Record<Act, Partial<Record<EquipmentSlot, string | null>>>;

export function emptyEquipment(): Equipment {
  return { "1": {}, "2": {}, "3": {} };
}

export type Character = {
  id: string;
  /** "player" or a companion id. */
  who: string;
  race: string | OffData;
  subrace: string | null | OffData;
  background: string | OffData;
  /** Base scores, before any bonus. */
  abilities: Record<Ability, number>;
  /** Index 0 is character level 1; at most 12. */
  levels: Level[];
  equipment: Equipment;
  notes: string;
};

export type PartyStatus = "core" | "alternative" | "bench";

export type ActParty = {
  active: string[];
  status: Record<string, PartyStatus>;
};

/** A ruleset identifier (`""` = not chosen) and the ruleset modifiers set away from that ruleset's values. */
export type Difficulty = {
  ruleset: string;
  overrides: Partial<Record<string, boolean | number>>;
};

export type Run = {
  version: 4;
  /** Stable identity of the run, kept across exports and renames; empty for a run migrated from version 1. */
  id: string;
  /** ISO date of the last edit; null when unknown. */
  updatedAt: string | null;
  name: string;
  origin: string;
  /** The game ruleset the run plays under, with the modifiers the player changed from its values. */
  difficulty: Difficulty;
  partySize: number;
  progress: { level: number; act: 1 | 2 | 3 };
  party: Record<"1" | "2" | "3", ActParty>;
  characters: Character[];
  decisions: Record<string, string>;
  bonuses: string[];
  uniqueItems: string[];
  notes: string;
};

export function emptyRun(id: string = crypto.randomUUID()): Run {
  return {
    version: 4,
    id,
    updatedAt: null,
    name: "",
    origin: "",
    difficulty: { ruleset: "", overrides: {} },
    partySize: 4,
    progress: { level: 1, act: 1 },
    party: {
      "1": { active: [], status: {} },
      "2": { active: [], status: {} },
      "3": { active: [], status: {} },
    },
    characters: [],
    decisions: {},
    bonuses: [],
    uniqueItems: [],
    notes: "",
  };
}
