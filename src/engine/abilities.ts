import type { GameData, Selector } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability, Character, Choice } from "../plan/model.ts";
import type { Issue } from "./issues.ts";

export const POINT_BUY = {
  budget: 27,
  min: 8,
  max: 15,
  cost: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 } as Record<number, number>,
};

export const ABILITY_CAP = 20;

export function checkPointBuy(character: Character): Issue[] {
  const issues: Issue[] = [];
  const base = { character: character.id, level: null, slot: null };
  let spent = 0;
  for (const ability of ABILITIES) {
    const value = character.abilities[ability];
    const cost = Number.isInteger(value) ? POINT_BUY.cost[value] : undefined;
    if (cost === undefined) {
      issues.push({ severity: "invalid", code: "abilityOutOfRange", ...base, params: { ability, value } });
    } else {
      spent += cost;
    }
  }
  if (spent > POINT_BUY.budget) {
    issues.push({ severity: "invalid", code: "pointBuyOverBudget", ...base, params: { spent, budget: POINT_BUY.budget } });
  } else if (spent < POINT_BUY.budget) {
    issues.push({ severity: "notice", code: "pointBuyUnderBudget", ...base, params: { spent, budget: POINT_BUY.budget } });
  }
  return issues;
}

function isAbility(entry: string): entry is Ability {
  return (ABILITIES as readonly string[]).includes(entry);
}

/** Finds the selector a slot id designates, or null when the id is malformed or unknown. */
function selectorOf(slot: string, choices: Record<string, Choice>, data: GameData, rows: Map<string, Selector[]>): Selector | null {
  const cut = slot.lastIndexOf("/");
  if (cut < 0) return null;
  const owner = slot.slice(0, cut);
  const indexText = slot.slice(cut + 1);
  if (!/^\d+$/.test(indexText)) return null;
  const index = Number(indexText);
  let selectors: Selector[] | undefined;
  if (owner.startsWith("feat:")) {
    const picked = choices[owner];
    const name = Array.isArray(picked) ? picked[0] : undefined;
    if (name === undefined || !Object.hasOwn(data.rules.feats, name)) return null;
    selectors = data.rules.feats[name]?.selectors;
  } else {
    selectors = rows.get(owner);
  }
  return selectors?.[index] ?? null;
}

/** Ability scores after the choices of levels 1..uptoLevel, each capped at 20. Unusable choices are skipped. */
export function abilityTotals(character: Character, data: GameData, uptoLevel: number): Record<Ability, number> {
  const totals = { ...character.abilities };
  const rows = new Map(data.rules.progressions.map((p) => [p.uuid, p.selectors]));
  for (const level of character.levels.slice(0, Math.max(0, uptoLevel))) {
    for (const [slot, choice] of Object.entries(level.choices)) {
      if (!Array.isArray(choice) || !choice.every(isAbility)) continue;
      const selector = selectorOf(slot, level.choices, data, rows);
      if (selector === null) continue;
      if (selector.function === "SelectAbilityBonus") {
        if (choice.length !== selector.bonuses.length) continue;
        choice.forEach((ability, i) => {
          totals[ability] += selector.bonuses[i] ?? 0;
        });
      } else if (selector.function === "SelectAbilities") {
        for (const ability of choice) totals[ability] += 1;
      }
    }
  }
  for (const ability of ABILITIES) totals[ability] = Math.min(totals[ability], ABILITY_CAP);
  return totals;
}
