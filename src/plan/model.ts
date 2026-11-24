export const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
export type Ability = (typeof ABILITIES)[number];

export const MAX_LEVELS = 12;

/** The picks made at one slot: identifiers, not decided yet, or a value outside the game data. */
export type Choice = string[] | "todo" | { offData: string };

export type Level = {
  /** The class taken at this level. */
  class: string;
  /** Choices by slot id (`<progression UUID>/<selector index>`). */
  choices: Record<string, Choice>;
};

export type Character = {
  id: string;
  /** "player" or a companion id. */
  who: string;
  race: string;
  subrace: string | null;
  background: string;
  /** Base scores, before any bonus. */
  abilities: Record<Ability, number>;
  /** Index 0 is character level 1; at most 12. */
  levels: Level[];
  items: string[];
  notes: string;
};

export type PartyStatus = "core" | "alternative" | "bench";

export type ActParty = {
  active: string[];
  status: Record<string, PartyStatus>;
};

export type Run = {
  version: 1;
  name: string;
  origin: string;
  difficulty: string;
  partySize: number;
  progress: { level: number; act: 1 | 2 | 3 };
  party: Record<"1" | "2" | "3", ActParty>;
  characters: Character[];
  decisions: Record<string, string>;
  bonuses: string[];
  uniqueItems: string[];
  notes: string;
};

export function emptyRun(): Run {
  return {
    version: 1,
    name: "",
    origin: "",
    difficulty: "",
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
