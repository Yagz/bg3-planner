import type { GameData } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability } from "../plan/model.ts";
import type { ResolvedLevel } from "./progression.ts";
import type { SelectorSlot } from "./validate.ts";

// Imports only types besides `ABILITIES`, so `validate.ts` can use it without an import cycle (`casting.ts` imports `validate.ts`).

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
