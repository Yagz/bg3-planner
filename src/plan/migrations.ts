import { DATA_SLOT_TARGETS } from "./equipmentSlots.ts";
import { CodecError } from "./errors.ts";

export const CURRENT_VERSION = 4;

/**
 * An item of a version-3 character the 3→4 migration could not place: `noSlot` when no equipment slot is known for it (no game
 * data, an id outside the data, or a data slot that is not an equipment slot), `taken` when its slots were already filled.
 */
export type UnplacedItem = { character: string; item: string; reason: "noSlot" | "taken" };

/**
 * What a migration may use beyond the document: the data slot of an item id (null for an id outside the game data), or
 * null when the caller has no game data; the list the migration adds its warnings to (English sentences, for the CLI);
 * and the same unplaced items as structured entries, for an interface that names them in its own language.
 */
export type MigrationContext = { itemSlot: ((id: string) => string | null) | null; warnings: string[]; unplaced: UnplacedItem[] };

export type Migration = (raw: unknown, context: MigrationContext) => unknown;

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
  // Version 4 replaces each character's flat `items` list by `equipment` per act; the old items are placed at act 1.
  3: (raw, context) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CodecError("Cannot migrate: the document is not an object");
    const characters = (raw as { characters?: unknown }).characters;
    // Malformed characters are left as they are: the shape check names them.
    return { ...raw, version: 4, characters: Array.isArray(characters) ? characters.map((c) => equipCharacter(c, context)) : characters };
  },
};

const NOT_PLACED_LINE = "BG3P3 items not placed: ";

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Moves a version-3 character's items to its act-1 equipment, in order, each to the first free slot its data slot allows.
 * An item it cannot place is never dropped: it is listed on one line added to the character's notes and gets a warning.
 */
function equipCharacter(character: unknown, context: MigrationContext): unknown {
  if (typeof character !== "object" || character === null || Array.isArray(character)) return character;
  const { items, ...rest } = character as Record<string, unknown>;
  // A character that is not of the version-3 shape is left as it is: the shape check names what is wrong.
  if (!isStringList(items) || "equipment" in rest) return character;
  const who = typeof rest["id"] === "string" ? rest["id"] : "?";
  const act: Record<string, string> = {};
  const unplaced: string[] = [];
  for (const id of items) {
    const failure = place(id, act, context.itemSlot);
    if (failure === null) continue;
    unplaced.push(id);
    context.warnings.push(`Item ${id} of ${who} could not be placed: ${failure.text}`);
    context.unplaced.push({ character: who, item: id, reason: failure.reason });
  }
  let notes = rest["notes"];
  if (unplaced.length > 0 && typeof notes === "string") {
    const line = NOT_PLACED_LINE + unplaced.join(", ");
    notes = notes === "" ? line : `${notes}\n\n${line}`;
  }
  return { ...rest, notes, equipment: { "1": act, "2": {}, "3": {} } };
}

/** Puts `id` in the first free slot of `act` its data slot allows; returns null when placed, or why it was not. */
function place(id: string, act: Record<string, string>, itemSlot: MigrationContext["itemSlot"]): { reason: UnplacedItem["reason"]; text: string } | null {
  if (itemSlot === null) return { reason: "noSlot", text: "no game data to find its slot" };
  const slot = itemSlot(id);
  if (slot === null) return { reason: "noSlot", text: "not an item of the game data" };
  if (!Object.hasOwn(DATA_SLOT_TARGETS, slot)) return { reason: "noSlot", text: `its slot ${slot} is not an equipment slot` };
  const targets = DATA_SLOT_TARGETS[slot] ?? [];
  const free = targets.find((target) => !Object.hasOwn(act, target));
  if (free === undefined) return { reason: "taken", text: `${targets.join(" and ")} already taken` };
  act[free] = id;
  return null;
}

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
export function migrate(
  raw: unknown,
  fromVersion: number,
  registry: Record<number, Migration> = MIGRATIONS,
  context: MigrationContext = { itemSlot: null, warnings: [], unplaced: [] },
): unknown {
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
    current = step(current, context);
  }
  return current;
}
