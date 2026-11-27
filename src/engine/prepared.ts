import type { GameData, Progression } from "../data/types.ts";
import { ABILITIES, isOffData } from "../plan/model.ts";
import type { Ability, Character } from "../plan/model.ts";
import { abilityTotals } from "./abilities.ts";
import type { Issue } from "./issues.ts";
import { resolve } from "./progression.ts";
import type { ResolvedLevel } from "./progression.ts";

/**
 * Number of spells a class prepares: floor(class level / divisor) + modifier of its casting ability, minimum 1.
 * bg3.wiki's class pages give the full class level for all four (the Paladin's halved level of the spec and Fextralife was
 * not kept); the divisor stays so that a correction is one value.
 */
export const PREPARED_COUNT: Record<string, { divisor: 1 | 2 }> = {
  Cleric: { divisor: 1 },
  Druid: { divisor: 1 },
  Paladin: { divisor: 1 },
  Wizard: { divisor: 1 },
};

/** The prepared spells of one character level, for the level's class. */
export type PreparedState = {
  cls: string;
  classLevel: number;
  /** The effective list: the level's own, or the one of the previous level of the same class; null when none up to here. */
  list: string[] | null;
  /** Character level whose list is effective; null when `list` is null. */
  from: number | null;
  /** Whether the level carries its own list. */
  own: boolean;
  count: number;
  /** Modifier of the class's casting ability at this level, the second term of `count` (0 when the class has no known ability). */
  modifier: number;
  /** Spells the class may prepare at this class level (always-prepared ones excluded). */
  pool: string[];
  /** Leveled spells always prepared by the class's and subclass's rows; they do not count. */
  always: string[];
};

/** The slot of the issues about prepared spells. */
export const PREPARED_SLOT = "prepared";

function isAbility(value: string | null): value is Ability {
  return value !== null && (ABILITIES as readonly string[]).includes(value);
}

/** Whether a spell is a leveled spell (level 1 or more); level 0 or null is a cantrip or a feature. */
function leveled(data: GameData, spell: string): boolean {
  const level = Object.hasOwn(data.rules.spells, spell) ? data.rules.spells[spell]?.level : null;
  return typeof level === "number" && level >= 1;
}

function listItems(data: GameData, list: string): string[] {
  return Object.hasOwn(data.rules.lists, list) ? (data.rules.lists[list]?.items ?? []) : [];
}

/** The state of each resolved level, null where the level's class does not prepare or is unknown. */
function states(character: Character, data: GameData, levels: ResolvedLevel[]): (PreparedState | null)[] {
  const { classes } = data.rules;
  const pools = new Map<string, Set<string>>();
  const always = new Map<string, Set<string>>();
  const lists = new Map<string, { list: string[]; from: number }>();
  return levels.map((resolved) => {
    const cls = resolved.class;
    if (!Object.hasOwn(PREPARED_COUNT, cls) || !Object.hasOwn(classes, cls) || !classes[cls]?.prepares_spells) return null;
    const n = resolved.level;
    const entry = character.levels[n - 1];
    const choices = entry?.choices ?? {};
    const pool = pools.get(cls) ?? new Set<string>();
    const fixed = always.get(cls) ?? new Set<string>();
    pools.set(cls, pool);
    always.set(cls, fixed);

    const own = new Set(resolved.rows.filter((row) => row.type !== "race").map((row: Progression) => row.uuid));
    for (const slot of resolved.slots) {
      if (!own.has(slot.progression)) continue;
      const { selector } = slot;
      if (selector.function !== "AddSpells" && selector.function !== "SelectSpells") continue;
      const items = listItems(data, selector.list);
      let spells: string[];
      if (selector.function === "AddSpells") {
        spells = items;
      } else {
        const choice = Object.hasOwn(choices, slot.id) ? choices[slot.id] : undefined;
        const picks = Array.isArray(choice) ? choice : [];
        spells = picks.filter((spell) => items.includes(spell));
      }
      const into = selector.prepare === null ? pool : selector.prepare === "AlwaysPrepared" ? fixed : null;
      if (into === null) continue;
      for (const spell of spells) if (leveled(data, spell)) into.add(spell);
    }

    if (entry?.prepared !== undefined) lists.set(cls, { list: entry.prepared, from: n });
    const effective = lists.get(cls) ?? null;
    const ability = classes[cls]?.spellcasting_ability ?? null;
    const score = isAbility(ability) ? abilityTotals(character, data, n)[ability] : 10;
    const divisor = PREPARED_COUNT[cls]?.divisor ?? 1;
    const modifier = Math.floor((score - 10) / 2);
    const count = Math.max(1, Math.floor(resolved.classLevel / divisor) + modifier);
    return {
      cls,
      classLevel: resolved.classLevel,
      list: effective === null ? null : [...effective.list],
      from: effective?.from ?? null,
      own: entry?.prepared !== undefined,
      count,
      modifier,
      pool: [...pool].filter((spell) => !fixed.has(spell)),
      always: [...fixed],
    };
  });
}

/** The prepared spells at character level `level` (1-based); null when the level's class does not prepare or is unknown. */
export function preparedState(character: Character, data: GameData, level: number): PreparedState | null {
  const { levels } = resolve(character, data);
  if (level < 1 || level > levels.length) return null;
  return states(character, data, levels.slice(0, level))[level - 1] ?? null;
}

/**
 * Checks the prepared spells of every level: a list where the class does not prepare, spells outside the pool and
 * duplicates in a level's own list, and at every level the effective list against the count. A class with no list is
 * reported once, at its first level with something to prepare.
 */
export function preparedIssues(character: Character, data: GameData): Issue[] {
  const issues: Issue[] = [];
  const { levels } = resolve(character, data);
  const missingReported = new Set<string>();
  states(character, data, levels).forEach((state, i) => {
    const n = i + 1;
    const entry = character.levels[i];
    const issue = (severity: Issue["severity"], code: Issue["code"], params: Issue["params"]) => {
      issues.push({ severity, code, character: character.id, level: n, slot: PREPARED_SLOT, params });
    };
    if (state === null) {
      // A class outside the game data may prepare: nothing is judged there.
      if (entry?.prepared !== undefined && !isOffData(entry.class)) issue("invalid", "preparedNotOffered", { class: levels[i]?.class ?? "" });
      return;
    }
    const { list, count, pool } = state;
    if (list === null) {
      if (pool.length > 0 && !missingReported.has(state.cls)) issue("incomplete", "preparedMissing", { count: 0, expected: count });
      if (pool.length > 0) missingReported.add(state.cls);
      return;
    }
    missingReported.add(state.cls);
    if (state.own) {
      const allowed = new Set(pool);
      const seen = new Set<string>();
      const repeated = new Set<string>();
      for (const spell of list) {
        if (seen.has(spell)) repeated.add(spell);
        seen.add(spell);
      }
      for (const spell of seen) if (!allowed.has(spell)) issue("invalid", "notInList", { item: spell });
      for (const spell of repeated) issue("invalid", "duplicateChoice", { item: spell });
    }
    if (list.length > count) issue("invalid", "preparedTooMany", { count: list.length, expected: count });
    else if (list.length < Math.min(count, pool.length)) issue("incomplete", "preparedMissing", { count: list.length, expected: count });
  });
  return issues;
}
