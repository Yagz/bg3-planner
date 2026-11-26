import type { GameData } from "../data/types.ts";
import { isOffData } from "../plan/model.ts";
import type { Character } from "../plan/model.ts";

const SKILL_PROFICIENCY = /^ProficiencyBonus\(Skill,\s*(\w+)\)$/;
const SKILL_EXPERTISE = /^ExpertiseBonus\((\w+)\)$/;

/** The skills a list of boosts makes the character proficient in (`ProficiencyBonus(Skill,X)`) and expert in (`ExpertiseBonus(X)`). */
export function skillBoosts(boosts: string[]): { proficient: string[]; expertise: string[] } {
  const proficient: string[] = [];
  const expertise: string[] = [];
  for (const boost of boosts) {
    const skill = SKILL_PROFICIENCY.exec(boost)?.[1];
    if (skill !== undefined) proficient.push(skill);
    const expert = SKILL_EXPERTISE.exec(boost)?.[1];
    if (expert !== undefined) expertise.push(expert);
  }
  return { proficient, expertise };
}

/** The skill proficiencies granted by the boosts of the named passives; unknown names grant nothing. */
export function passiveSkills(data: GameData, names: string[]): string[] {
  const { passives } = data.rules;
  return names.flatMap((name) => (Object.hasOwn(passives, name) ? skillBoosts(passives[name]?.boosts ?? []).proficient : []));
}

/** Where a skill granted without a pick comes from. */
export type SkillSource = "race" | "subrace" | "background";

/**
 * Skills granted at character level ≤ `level` by the race rows, the subrace rows (their `boosts` and `passives_added`)
 * and the background's passives, each with its first source in that order. Identity fields that are undecided, outside
 * the game data or unknown grant nothing.
 */
export function grantedSkills(character: Character, data: GameData, level: number): Map<string, SkillSource> {
  const { races, backgrounds, progressions } = data.rules;
  const granted = new Map<string, SkillSource>();
  const add = (skills: string[], source: SkillSource) => {
    for (const skill of skills) if (!granted.has(skill)) granted.set(skill, source);
  };
  const rowSkills = (table: string) =>
    progressions
      .filter((row) => row.table === table && !row.multiclass && row.level <= level)
      .flatMap((row) => [...skillBoosts(row.boosts).proficient, ...passiveSkills(data, row.passives_added)]);

  const { race, subrace, background } = character;
  if (!isOffData(race) && Object.hasOwn(races, race) && races[race]?.parent === null) {
    add(rowSkills(races[race]?.table ?? ""), "race");
    if (subrace !== null && !isOffData(subrace) && Object.hasOwn(races, subrace) && races[subrace]?.parent === race) {
      add(rowSkills(races[subrace]?.table ?? ""), "subrace");
    }
  }
  if (!isOffData(background) && Object.hasOwn(backgrounds, background)) add(passiveSkills(data, backgrounds[background]?.passives ?? []), "background");
  return granted;
}
