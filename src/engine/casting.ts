import type { GameData } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability, Character } from "../plan/model.ts";
import type { ResolvedLevel } from "./progression.ts";
import { truncate } from "./coverage.ts";
import { resolve } from "./progression.ts";
import { levelSlots } from "./validate.ts";
import type { SelectorSlot } from "./validate.ts";

/** The ability of that name, or null. */
export function asAbility(name: string | null | undefined): Ability | null {
  return ABILITIES.find((ability) => ability === name) ?? null;
}

/**
 * The ability a `SelectSpells` slot's spells are cast with: the selector's own ability (race and feat slots), else the
 * spellcasting ability of the subclass or class whose row offers the slot; null when none applies or the slot picks no spells.
 */
export function castingAbility(level: ResolvedLevel, slot: SelectorSlot, data: GameData): Ability | null {
  if (slot.selector.function !== "SelectSpells") return null;
  const own = asAbility(slot.selector.ability);
  if (own !== null) return own;
  const progression = level.slots.find(({ id }) => id === slot.id)?.progression;
  const row = level.rows.find(({ uuid }) => uuid === progression);
  if (row === undefined || (row.type !== "class" && row.type !== "subclass")) return null;
  return asAbility(Object.hasOwn(data.rules.classes, row.name) ? data.rules.classes[row.name]?.spellcasting_ability : null);
}

/** Per character level, the casting ability of each `SelectSpells` slot (feat slots included) that has one. */
export function castingAbilities(character: Character, data: GameData): Record<string, Ability>[] {
  return resolve(character, data).levels.map((level) => {
    const slots = levelSlots(level, character.levels[level.level - 1]?.choices ?? {}, data);
    const out: Record<string, Ability> = {};
    for (const slot of [...slots.selectors, ...(slots.feat?.selectors ?? [])]) {
      const ability = castingAbility(level, slot, data);
      if (ability !== null) out[slot.id] = ability;
    }
    return out;
  });
}

/** A class or race that gives the character spells it casts with an ability, which sets the spell save DC. */
export type SpellSource = { kind: "class" | "race"; id: string; ability: Ability };

/**
 * The spell sources of a character at `level` (the character cut to its first `level` levels): one per base class taken
 * whose subclass (if picked and having a spellcasting ability) or else class has one, and whose class or subclass rows
 * up to `level` hold a `SelectSpells` or `AddSpells` selector (a Ranger 1 has no spell yet); the ability is the
 * subclass's when it has one. Then one per race or subrace row with such a selector naming an ability. In order of
 * first level, deduplicated by id and ability.
 */
export function spellSources(character: Character, data: GameData, level: number): SpellSource[] {
  const { classes, races } = data.rules;
  const levels = resolve(truncate(character, level), data).levels;
  const hasSpells = (row: { selectors: { function: string }[] }) => row.selectors.some((s) => s.function === "SelectSpells" || s.function === "AddSpells");
  const abilityOf = (name: string) => asAbility(Object.hasOwn(classes, name) ? classes[name]?.spellcasting_ability : null);

  const sources: SpellSource[] = [];
  const add = (source: SpellSource) => {
    if (!sources.some((s) => s.kind === source.kind && s.id === source.id && s.ability === source.ability)) sources.push(source);
  };

  const byClass = new Map<string, { subclass: string | null; spells: boolean }>();
  for (const { class: cls, rows } of levels) {
    if (cls === "") continue;
    const entry = byClass.get(cls) ?? { subclass: null, spells: false };
    for (const row of rows) {
      if (row.type === "subclass") entry.subclass = row.name;
      if ((row.type === "class" || row.type === "subclass") && hasSpells(row)) entry.spells = true;
    }
    byClass.set(cls, entry);
  }
  for (const [cls, { subclass, spells }] of byClass) {
    if (!spells) continue;
    const ability = (subclass === null ? null : abilityOf(subclass)) ?? abilityOf(cls);
    if (ability !== null) add({ kind: "class", id: cls, ability });
  }

  const { race, subrace } = character;
  const raceIds = [race, subrace].filter((name): name is string => typeof name === "string" && Object.hasOwn(races, name));
  for (const { rows } of levels) {
    for (const row of rows) {
      if (row.type !== "race") continue;
      const id = raceIds.find((name) => races[name]?.table === row.table);
      if (id === undefined) continue;
      for (const selector of row.selectors) {
        if (selector.function !== "AddSpells" && selector.function !== "SelectSpells") continue;
        const ability = asAbility(selector.ability);
        if (ability !== null) add({ kind: "race", id, ability });
      }
    }
  }
  return sources;
}
