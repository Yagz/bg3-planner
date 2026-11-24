import type { GameData, Progression, Selector } from "../data/types.ts";
import { MAX_LEVELS } from "../plan/model.ts";
import type { Character } from "../plan/model.ts";
import type { Issue } from "./issues.ts";

/** A choice offered by a progression row; its id is `<progression uuid>/<selector index>`. */
export type Slot = {
  id: string;
  progression: string;
  selector: Selector;
  /** Character level (1-based). */
  level: number;
};

export type ResolvedLevel = {
  /** Character level (1-based). */
  level: number;
  class: string;
  /** Level reached in `class` at this character level. */
  classLevel: number;
  /** Class rows, then subclass rows, then race rows, then subrace rows. */
  rows: Progression[];
  /**
   * Every selector of `rows`, in row order then selector order, except a selector equal to one of an earlier row of the
   * same (table, level, multiclass) group: the game applies every row of such a group, and that choice is made once.
   */
  slots: Slot[];
  /** Allowed subclass names when this level requires choosing one. */
  subclassChoice: string[] | null;
  featChoice: boolean;
};

export function subclassSlot(cls: string): string {
  return `subclass:${cls}`;
}

/** Progression rows grouped by (table, level, multiclass). */
type RowIndex = Map<string, Progression[]>;

const indexes = new WeakMap<GameData, RowIndex>();

function rowKey(table: string, level: number, multiclass: boolean): string {
  return `${table}|${level}|${multiclass}`;
}

function rowIndex(data: GameData): RowIndex {
  let index = indexes.get(data);
  if (index === undefined) {
    index = new Map();
    for (const row of data.rules.progressions) {
      const key = rowKey(row.table, row.level, row.multiclass);
      const group = index.get(key);
      if (group === undefined) index.set(key, [row]);
      else group.push(row);
    }
    indexes.set(data, index);
  }
  return index;
}

/** Resolves the progression rows and choice slots of each character level; reports what cannot be resolved. */
export function resolve(character: Character, data: GameData): { levels: ResolvedLevel[]; issues: Issue[] } {
  const { classes, races, backgrounds } = data.rules;
  const index = rowIndex(data);
  const issues: Issue[] = [];
  const issue = (severity: Issue["severity"], code: string, level: number | null, slot: string | null, params: Issue["params"] = {}) => {
    issues.push({ severity, code, character: character.id, level, slot, params });
  };

  /** Rows of one (table, level, multiclass) group, in `rules.progressions` order; all of them apply. */
  const rowsAt = (table: string, level: number, multiclass: boolean): Progression[] => index.get(rowKey(table, level, multiclass)) ?? [];

  // Race and subrace.
  let raceTable: string | null = null;
  let subraceTable: string | null = null;
  const { race, subrace } = character;
  if (race === "") {
    issue("incomplete", "choiceMissing", null, "race");
  } else if (!Object.hasOwn(races, race) || races[race]?.parent !== null) {
    issue("invalid", "unknownRace", null, "race", { race });
  } else {
    raceTable = races[race]?.table ?? null;
    const hasSubraces = Object.values(races).some((r) => r.parent === race);
    if (subrace === null) {
      if (hasSubraces) issue("incomplete", "choiceMissing", null, "subrace");
    } else if (!Object.hasOwn(races, subrace) || races[subrace]?.parent === null) {
      issue("invalid", "unknownSubrace", null, "subrace", { subrace });
    } else if (races[subrace]?.parent !== race) {
      issue("invalid", "subraceMismatch", null, "subrace", { race, subrace });
    } else {
      subraceTable = races[subrace]?.table ?? null;
    }
  }

  // Background.
  if (character.background === "") {
    issue("incomplete", "choiceMissing", null, "background");
  } else if (!Object.hasOwn(backgrounds, character.background)) {
    issue("invalid", "unknownBackground", null, "background", { background: character.background });
  }

  if (character.levels.length > MAX_LEVELS) {
    issue("invalid", "tooManyLevels", null, null, { count: character.levels.length, max: MAX_LEVELS });
  }

  const firstClass = character.levels[0]?.class;
  const classLevels = new Map<string, number>();
  /** Subclass chosen per class, once its choice is valid. */
  const subclasses = new Map<string, string>();
  const levels: ResolvedLevel[] = [];

  character.levels.slice(0, MAX_LEVELS).forEach((entry, i) => {
    const n = i + 1;
    const cls = entry.class;
    const classLevel = (classLevels.get(cls) ?? 0) + 1;
    classLevels.set(cls, classLevel);

    const classRows: Progression[] = [];
    const subclassRows: Progression[] = [];
    let subclassChoice: string[] | null = null;

    if (cls === "") {
      issue("incomplete", "choiceMissing", n, "class");
    } else if (!Object.hasOwn(classes, cls) || classes[cls]?.parent !== null) {
      issue("invalid", "unknownClass", n, "class", { class: cls });
    } else {
      const table = classes[cls]?.table ?? "";
      const multiclass = classLevel === 1 && cls !== firstClass;
      classRows.push(...rowsAt(table, classLevel, multiclass));

      const offered = [...new Set(classRows.flatMap((r) => r.subclasses))];
      if (offered.length > 0) {
        subclassChoice = offered;
        const slot = subclassSlot(cls);
        const choice = entry.choices[slot];
        if (choice === undefined || choice === "todo") {
          issue("incomplete", "choiceMissing", n, slot, { class: cls });
        } else if (!Array.isArray(choice)) {
          issue("notice", "offData", n, slot, { class: cls });
        } else if (choice.length !== 1 || !offered.includes(choice[0] ?? "")) {
          issue("invalid", "subclassNotOffered", n, slot, { class: cls, subclass: choice.join(", ") });
        } else {
          subclasses.set(cls, choice[0] ?? "");
        }
      }

      const subclass = subclasses.get(cls);
      const subclassTable = subclass !== undefined && Object.hasOwn(classes, subclass) ? classes[subclass]?.table : undefined;
      if (subclassTable !== undefined) subclassRows.push(...rowsAt(subclassTable, classLevel, false));
    }

    const rows = [
      ...classRows,
      ...subclassRows,
      ...(raceTable === null ? [] : rowsAt(raceTable, n, false)),
      ...(subraceTable === null ? [] : rowsAt(subraceTable, n, false)),
    ];
    const slots = slotsOf(rows, n);
    levels.push({ level: n, class: cls, classLevel, rows, slots, subclassChoice, featChoice: classRows.some((r) => r.feat) });
  });

  return { levels, issues };
}

/** Deep equality of JSON values; object key order does not matter. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  const ob = b as Record<string, unknown>;
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(ob, k) && jsonEqual((a as Record<string, unknown>)[k], ob[k]));
}

/**
 * Slots of a level's rows. Rows sharing (table, level, multiclass) all apply; a selector equal to one of an earlier row
 * of its group opens no slot of its own (the same choice, made in the earlier row's slot). Slot ids keep the selector's
 * index in its row.
 */
function slotsOf(rows: Progression[], level: number): Slot[] {
  const seen = new Map<string, Selector[]>();
  const slots: Slot[] = [];
  for (const row of rows) {
    const key = rowKey(row.table, row.level, row.multiclass);
    const earlier = seen.get(key) ?? [];
    row.selectors.forEach((selector, s) => {
      if (!earlier.some((other) => jsonEqual(other, selector))) slots.push({ id: `${row.uuid}/${s}`, progression: row.uuid, selector, level });
    });
    seen.set(key, [...earlier, ...row.selectors]);
  }
  return slots;
}
