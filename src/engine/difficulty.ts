import type { BuildModifier, GameData, RulesetModifierDef } from "../data/types.ts";
import type { Difficulty } from "../plan/model.ts";

/** What the run's ruleset changes for a build, every value read from the game data. */
export type RulesetEffects = {
  /** Whether the ruleset is undecided (`""`) or one of the game data's rulesets; an unknown one falls back to the defaults. */
  known: boolean;
  /** Whether a character may take a level in another class (`MULTICLASSING`). */
  multiclass: boolean;
  /** Added to every proficiency bonus (`PROFICIENCY_BONUS`). */
  proficiencyBonus: number;
  /** Whether the Honour mode stat changes apply (`HONOUR_STATS`). */
  honourStats: boolean;
};

/** Whether a value fits a modifier: its type, and its range for an integer. */
function fits(value: unknown, def: RulesetModifierDef): value is boolean | number {
  if (def.type === "bool") return typeof value === "boolean";
  return Number.isInteger(value) && (def.min === undefined || (value as number) >= def.min) && (def.max === undefined || (value as number) <= def.max);
}

/**
 * The build effects of a difficulty: each modifier takes the run's override, else the ruleset's value, else the modifier's
 * default. An override that does not fit its modifier, or names no build modifier, is ignored.
 */
export function rulesetEffects(difficulty: Difficulty, data: GameData): RulesetEffects {
  const { rulesets, rulesetModifiers } = data.rules;
  const ruleset = Object.hasOwn(rulesets, difficulty.ruleset) ? rulesets[difficulty.ruleset] : undefined;
  const value = (modifier: BuildModifier): boolean | number => {
    const def = rulesetModifiers[modifier];
    const override = Object.hasOwn(difficulty.overrides, modifier) ? difficulty.overrides[modifier] : undefined;
    if (fits(override, def)) return override;
    const set = ruleset?.values[modifier];
    return set !== undefined && fits(set, def) ? set : def.default;
  };
  return {
    known: difficulty.ruleset === "" || ruleset !== undefined,
    multiclass: value("MULTICLASSING") === true,
    proficiencyBonus: Number(value("PROFICIENCY_BONUS")),
    honourStats: value("HONOUR_STATS") === true,
  };
}
