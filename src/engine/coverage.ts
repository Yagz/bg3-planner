import type { GameData } from "../data/types.ts";
import type { Ability, Character, Run } from "../plan/model.ts";
import { abilityTotals } from "./abilities.ts";
import { checkChoice, emptyKnown } from "./choices.ts";
import { rulesetEffects } from "./difficulty.ts";
import { resolve } from "./progression.ts";
import { SkillTracker } from "./skills.ts";
import { levelSlots } from "./validate.ts";
import type { SelectorSlot } from "./validate.ts";

export type SkillCoverage = {
  skill: string;
  ability: Ability;
  /** The active members proficient in the skill, in party order; empty when nobody is (the skill is uncovered). */
  proficient: string[];
  /**
   * The active member with the highest skill value; on a tie, one with expertise, then one proficient, then the first one.
   * Null when the party is empty. It may be unproficient while another member is: read `proficient` for the coverage.
   */
  best: { character: string; value: number; proficient: boolean; expertise: boolean } | null;
};

/**
 * Skills a character is proficient in and has expertise in, over all its levels: `SelectSkills` and
 * `SelectSkillsExpertise` picks (proficiency too where the selector grants it), and the skills `SkillTracker` reads from
 * its rows, background, feats and held passives. Expertise counts only where the character is proficient. Identity fields outside the game data contribute nothing.
 */
export function skillProficiencies(character: Character, data: GameData): { proficient: Set<string>; expertise: Set<string> } {
  const skills = new SkillTracker(character, data);
  const known = emptyKnown();
  const scores = { ...character.abilities };
  for (const level of resolve(character, data).levels) {
    const choices = character.levels[level.level - 1]?.choices ?? {};
    skills.addLevel(level);
    const slots = levelSlots(level, choices, data);
    const pick = ({ id, selector, scope }: SelectorSlot) => {
      const choice = Object.hasOwn(choices, id) ? choices[id] : undefined;
      if (!Array.isArray(choice)) return;
      if (selector.function === "SelectSkills") for (const skill of choice) known.skills.add(skill);
      else if (selector.function === "SelectSkillsExpertise") {
        // `requires_proficiency` false (Knowledge Domain): the pick grants proficiency along with expertise.
        for (const skill of choice) known.expertise.add(skill);
        if (selector.requires_proficiency === false) for (const skill of choice) known.skills.add(skill);
      } else if (selector.function === "SelectPassives" || selector.function === "ReplacePassives") {
        // Replays the pick to know which passives are still held; its issues belong to `validate`.
        checkChoice(selector, choice, { data, character: character.id, level: level.level, scope, slot: id, scores, known });
      }
    };
    slots.selectors.forEach(pick);
    if (slots.feat?.feat != null) {
      slots.feat.selectors.forEach(pick);
      skills.addFeat(slots.feat.feat);
    }
  }
  return { proficient: skills.proficient(known), expertise: skills.expertise(known) };
}

/** Proficiency bonus at a character level: 2 at levels 1-4, 3 at 5-8, 4 at 9-12. */
export function proficiencyBonus(level: number): number {
  return level <= 4 ? 2 : level <= 8 ? 3 : 4;
}

/** The characters of the active party of the run's current act, in party order. */
export function activeParty(run: Run): Character[] {
  const ids = run.party[String(run.progress.act) as "1" | "2" | "3"]?.active ?? [];
  return ids.flatMap((id) => run.characters.filter((c) => c.id === id).slice(0, 1));
}

/** A character cut to its first `level` levels. */
export function truncate(character: Character, level: number): Character {
  return { ...character, levels: character.levels.slice(0, Math.max(0, Math.min(level, character.levels.length))) };
}

/** One active member's value in one skill. */
export type MemberSkillValue = { character: string; value: number; proficient: boolean; expertise: boolean };

/** One skill's value for one character. */
export type SkillValue = { skill: string; ability: Ability; value: number; proficient: boolean; expertise: boolean };

/**
 * One character's value in every skill of the game, in the game's skill order, the character cut to
 * `min(level, its levels)`: ability modifier, plus the proficiency bonus of the reached level plus `addedBonus` (the
 * ruleset's `PROFICIENCY_BONUS`), doubled with expertise, when proficient.
 */
export function characterSkillValues(character: Character, data: GameData, level: number, addedBonus: number): SkillValue[] {
  const cut = truncate(character, level);
  const reached = cut.levels.length;
  const totals = abilityTotals(cut, data, reached);
  const bonus = proficiencyBonus(reached) + addedBonus;
  const { proficient: skills, expertise: experts } = skillProficiencies(cut, data);
  return Object.entries(data.skills).map(([skill, ability]) => {
    const proficient = skills.has(skill);
    const expertise = experts.has(skill);
    const value = Math.floor((totals[ability] - 10) / 2) + (proficient ? bonus * (expertise ? 2 : 1) : 0);
    return { skill, ability, value, proficient, expertise };
  });
}

/**
 * Every active member's value in every skill, in the game's skill order then party order, each character cut to
 * `min(level, its levels)`: ability modifier, plus the proficiency bonus (doubled with expertise) when proficient; the
 * run's ruleset adds its `PROFICIENCY_BONUS` to every proficiency bonus.
 */
export function partySkillValues(run: Run, data: GameData, level: number): { skill: string; ability: Ability; members: MemberSkillValue[] }[] {
  const added = rulesetEffects(run.difficulty, data).proficiencyBonus;
  const members = activeParty(run).map((character) => ({ id: character.id, values: characterSkillValues(character, data, level, added) }));
  return Object.entries(data.skills).map(([skill, ability], i) => ({
    skill,
    ability,
    members: members.map(({ id, values }) => {
      const { value, proficient, expertise } = values[i] as SkillValue;
      return { character: id, value, proficient, expertise };
    }),
  }));
}

/**
 * The best skill value of the active party for every skill, each character cut to `min(level, its levels)`; the run's
 * ruleset adds its `PROFICIENCY_BONUS` to every proficiency bonus.
 */
export function coverage(run: Run, data: GameData, level: number): SkillCoverage[] {
  return partySkillValues(run, data, level).map(({ skill, ability, members }) => {
    let best: SkillCoverage["best"] = null;
    const rank = (entry: { proficient: boolean; expertise: boolean }) => (entry.expertise ? 2 : entry.proficient ? 1 : 0);
    for (const entry of members) {
      if (best === null || entry.value > best.value || (entry.value === best.value && rank(entry) > rank(best))) best = entry;
    }
    return { skill, ability, proficient: members.filter((member) => member.proficient).map((member) => member.character), best };
  });
}
