import type { GameData } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability, Run } from "../plan/model.ts";
import { abilityTotals } from "./abilities.ts";
import { activeParty, partySkillValues, truncate } from "./coverage.ts";

/** What one member brings to the active group. */
export type Contribution = {
  /** Skills where the member is the single proficient active member. */
  only: string[];
  /**
   * Skills at least one active member is proficient in where the member's value is strictly above every other active
   * member's (a tie gives the skill to nobody), apart from those in `only`; empty for a lone member.
   */
  best: string[];
  /** Abilities where the member's total is strictly above every other active member's; empty for a lone member. */
  highest: Ability[];
};

/** What each member of the run's active party brings, keyed by character id, each character cut to `min(level, its levels)`. */
export function contribution(run: Run, data: GameData, level: number): Map<string, Contribution> {
  const members = activeParty(run);
  const skills = partySkillValues(run, data, level);
  const totals = members.map((character) => {
    const cut = truncate(character, level);
    return abilityTotals(cut, data, cut.levels.length);
  });
  const result = new Map<string, Contribution>();
  // A lone member has nobody to be compared with: only `only` says something about it.
  const compared = members.length >= 2;
  members.forEach((character, i) => {
    const only = skills.filter((s) => s.members.filter((m) => m.proficient).length === 1 && s.members[i]!.proficient).map((s) => s.skill);
    const best = !compared
      ? []
      : skills
          .filter((s) => s.members.some((m) => m.proficient) && !only.includes(s.skill) && s.members.every((other, j) => j === i || s.members[i]!.value > other.value))
          .map((s) => s.skill);
    const highest = !compared ? [] : ABILITIES.filter((ability) => totals.every((other, j) => j === i || totals[i]![ability] > other[ability]));
    result.set(character.id, { only, best, highest });
  });
  return result;
}
