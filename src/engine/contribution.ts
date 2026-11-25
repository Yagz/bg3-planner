import type { GameData } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability, Run } from "../plan/model.ts";
import { abilityTotals } from "./abilities.ts";
import { activeParty, coverage, truncate } from "./coverage.ts";

/** What one member brings to the active group. */
export type Contribution = {
  /** Skills where the member is the single proficient active member. */
  only: string[];
  /** Skills where the member has the group's best value (`coverage().best`), apart from those in `only`. */
  best: string[];
  /** Abilities where the member's total is strictly above every other active member's. */
  highest: Ability[];
};

/** What each member of the run's active party brings, keyed by character id, each character cut to `min(level, its levels)`. */
export function contribution(run: Run, data: GameData, level: number): Map<string, Contribution> {
  const members = activeParty(run);
  const skills = coverage(run, data, level);
  const totals = members.map((character) => {
    const cut = truncate(character, level);
    return abilityTotals(cut, data, cut.levels.length);
  });
  const result = new Map<string, Contribution>();
  members.forEach((character, i) => {
    const only = skills.filter((s) => s.proficient.length === 1 && s.proficient[0] === character.id).map((s) => s.skill);
    const best = skills.filter((s) => s.best?.character === character.id && !only.includes(s.skill)).map((s) => s.skill);
    const highest = ABILITIES.filter((ability) => totals.every((other, j) => j === i || totals[i]![ability] > other[ability]));
    result.set(character.id, { only, best, highest });
  });
  return result;
}
