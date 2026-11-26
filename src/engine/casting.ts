import type { GameData } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability, Character } from "../plan/model.ts";
import type { ResolvedLevel } from "./progression.ts";
import { resolve } from "./progression.ts";
import { levelSlots } from "./validate.ts";
import type { SelectorSlot } from "./validate.ts";

function asAbility(name: string | null | undefined): Ability | null {
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
