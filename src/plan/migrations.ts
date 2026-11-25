import { CodecError } from "./errors.ts";

export const CURRENT_VERSION = 3;

export type Migration = (raw: unknown) => unknown;

/** `MIGRATIONS[v]` turns a version-v document into a version-(v+1) one. */
export const MIGRATIONS: Record<number, Migration> = {
  // Version 2 adds the run's stable id (empty until the planner assigns one) and its update date.
  1: (raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CodecError("Cannot migrate: the document is not an object");
    return { ...raw, version: 2, id: "", updatedAt: null };
  },
  // Version 3 keys the difficulty by the game's ruleset: `{ ruleset, overrides }` instead of a free text.
  2: (raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CodecError("Cannot migrate: the document is not an object");
    const label = (raw as { difficulty?: unknown }).difficulty;
    // A malformed difficulty is left as is: the shape check names it.
    const difficulty = typeof label === "string" ? { ruleset: rulesetOfLabel(label), overrides: {} } : label;
    return { ...raw, version: 3, difficulty };
  },
};

// The four English labels of the free text a version-2 run held, mapped to the game's ruleset identifiers. This is the only hand-written
// mapping: the old text is not an identifier, so the data cannot supply it. Any other text is kept as the ruleset id (the engine reports it).
const LEGACY_DIFFICULTY_LABELS: Record<string, string> = {
  explorer: "DIFFICULTY_EASY",
  balanced: "DIFFICULTY_MEDIUM",
  tactician: "DIFFICULTY_HARD",
  honour: "RULESET_HONOUR",
};

function rulesetOfLabel(label: string): string {
  return LEGACY_DIFFICULTY_LABELS[label.toLowerCase()] ?? label;
}

/** Brings a document of `fromVersion` up to CURRENT_VERSION, one step at a time. */
export function migrate(raw: unknown, fromVersion: number, registry: Record<number, Migration> = MIGRATIONS): unknown {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new CodecError(`Invalid format version ${String(fromVersion)}`);
  }
  if (fromVersion > CURRENT_VERSION) {
    throw new CodecError(`Format version ${fromVersion} is newer than this planner understands (${CURRENT_VERSION})`);
  }
  let current = raw;
  for (let version = fromVersion; version < CURRENT_VERSION; version++) {
    const step = registry[version];
    if (step === undefined) {
      throw new CodecError(`No migration from format version ${version} to ${version + 1}`);
    }
    current = step(current);
  }
  return current;
}
