import type { GameData } from "../data/types.ts";
import { isOffData } from "../plan/model.ts";
import type { Ability, Character, Run } from "../plan/model.ts";
import { abilityTotals } from "./abilities.ts";
import { checkChoice, emptyKnown, heldPassives } from "./choices.ts";
import { resolve } from "./progression.ts";
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

const SKILL_PROFICIENCY = /^ProficiencyBonus\(Skill,\s*(\w+)\)$/;
const SKILL_EXPERTISE = /^ExpertiseBonus\((\w+)\)$/;

/**
 * Skills a character is proficient in and has expertise in, over all its levels: `SelectSkills` and
 * `SelectSkillsExpertise` picks, and the `ProficiencyBonus(Skill,X)` / `ExpertiseBonus(X)` boosts of its background's
 * passives, its rows' added passives, the passives it holds from picks and its feats' passives. Expertise counts only
 * where the character is proficient. Identity fields outside the game data contribute nothing.
 */
export function skillProficiencies(character: Character, data: GameData): { proficient: Set<string>; expertise: Set<string> } {
  const { backgrounds, feats, passives } = data.rules;
  const proficient = new Set<string>();
  const expertise = new Set<string>();
  const passiveNames: string[] = [];
  const { background } = character;
  if (!isOffData(background) && Object.hasOwn(backgrounds, background)) passiveNames.push(...(backgrounds[background]?.passives ?? []));

  const known = emptyKnown();
  const scores = { ...character.abilities };
  for (const level of resolve(character, data).levels) {
    const choices = character.levels[level.level - 1]?.choices ?? {};
    for (const row of level.rows) passiveNames.push(...row.passives_added);
    const slots = levelSlots(level, choices, data);
    const pick = ({ id, selector, scope }: SelectorSlot) => {
      const choice = Object.hasOwn(choices, id) ? choices[id] : undefined;
      if (!Array.isArray(choice)) return;
      if (selector.function === "SelectSkills") for (const skill of choice) proficient.add(skill);
      else if (selector.function === "SelectSkillsExpertise") for (const skill of choice) expertise.add(skill);
      else if (selector.function === "SelectPassives" || selector.function === "ReplacePassives") {
        // Replays the pick to know which passives are still held; its issues belong to `validate`.
        checkChoice(selector, choice, { data, character: character.id, level: level.level, scope, slot: id, scores, known });
      }
    };
    slots.selectors.forEach(pick);
    if (slots.feat?.feat != null) {
      slots.feat.selectors.forEach(pick);
      passiveNames.push(...(feats[slots.feat.feat]?.passives ?? []));
    }
  }
  passiveNames.push(...heldPassives(known));

  for (const name of passiveNames) {
    if (!Object.hasOwn(passives, name)) continue;
    for (const boost of passives[name]?.boosts ?? []) {
      const skill = SKILL_PROFICIENCY.exec(boost)?.[1];
      if (skill !== undefined) proficient.add(skill);
      const expert = SKILL_EXPERTISE.exec(boost)?.[1];
      if (expert !== undefined) expertise.add(expert);
    }
  }
  for (const skill of expertise) if (!proficient.has(skill)) expertise.delete(skill);
  return { proficient, expertise };
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

/** The best skill value of the active party for every skill, each character cut to `min(level, its levels)`. */
export function coverage(run: Run, data: GameData, level: number): SkillCoverage[] {
  const members = activeParty(run).map((character) => {
    const cut = truncate(character, level);
    const reached = cut.levels.length;
    return { id: character.id, totals: abilityTotals(cut, data, reached), bonus: proficiencyBonus(reached), ...skillProficiencies(cut, data) };
  });
  return Object.entries(data.skills).map(([skill, ability]) => {
    let best: SkillCoverage["best"] = null;
    const rank = (entry: { proficient: boolean; expertise: boolean }) => (entry.expertise ? 2 : entry.proficient ? 1 : 0);
    for (const member of members) {
      const proficient = member.proficient.has(skill);
      const expertise = member.expertise.has(skill);
      const value = Math.floor((member.totals[ability] - 10) / 2) + (proficient ? member.bonus * (expertise ? 2 : 1) : 0);
      const entry = { character: member.id, value, proficient, expertise };
      if (best === null || value > best.value || (value === best.value && rank(entry) > rank(best))) best = entry;
    }
    return { skill, ability, proficient: members.filter((member) => member.proficient.has(skill)).map((member) => member.id), best };
  });
}
