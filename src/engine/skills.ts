import type { GameData, Progression } from "../data/types.ts";
import { isOffData } from "../plan/model.ts";
import type { Character } from "../plan/model.ts";
import { heldPassives } from "./choices.ts";
import type { Known } from "./choices.ts";
import type { ResolvedLevel } from "./progression.ts";

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

/** Skills granted by a list of boosts plus the boosts of the named passives; unknown passive names grant nothing. */
export function skillGrants(data: GameData, boosts: string[], passiveNames: string[]): { proficient: string[]; expertise: string[] } {
  const { passives } = data.rules;
  const all = [...boosts, ...passiveNames.flatMap((name) => (Object.hasOwn(passives, name) ? (passives[name]?.boosts ?? []) : []))];
  return skillBoosts(all);
}

/** Skills a progression row grants without a pick: its own boosts and the boosts of the passives it adds. */
export function rowSkillGrants(data: GameData, row: Progression): { proficient: string[]; expertise: string[] } {
  return skillGrants(data, row.boosts, row.passives_added);
}

/** Skills the character's background grants through its passives; nothing when it is undecided, outside the data or unknown. */
export function backgroundSkillGrants(character: Character, data: GameData): { proficient: string[]; expertise: string[] } {
  const { backgrounds } = data.rules;
  const { background } = character;
  const names = !isOffData(background) && Object.hasOwn(backgrounds, background) ? (backgrounds[background]?.passives ?? []) : [];
  return skillGrants(data, [], names);
}

/**
 * The skills of a character walked level by level, shared by `validate` and `coverage` so that both read proficiency
 * and expertise from the same sources: picks (held in `Known`), the background's passives, the rows' boosts and added
 * passives, the feats' passives and the passives held from picks.
 */
export class SkillTracker {
  private readonly data: GameData;
  private readonly proficientGranted = new Set<string>();
  private readonly expertiseGranted = new Set<string>();

  constructor(character: Character, data: GameData) {
    this.data = data;
    this.add(backgroundSkillGrants(character, data));
  }

  private add(grants: { proficient: string[]; expertise: string[] }): void {
    for (const skill of grants.proficient) this.proficientGranted.add(skill);
    for (const skill of grants.expertise) this.expertiseGranted.add(skill);
  }

  /** Counts what the rows of a level grant. */
  addLevel(level: ResolvedLevel): void {
    for (const row of level.rows) this.add(rowSkillGrants(this.data, row));
  }

  /** Counts what a feat's passives grant. */
  addFeat(feat: string): void {
    const { feats } = this.data.rules;
    this.add(skillGrants(this.data, [], Object.hasOwn(feats, feat) ? (feats[feat]?.passives ?? []) : []));
  }

  /** Skills proficient now: picked (`known.skills`), granted so far, or from the passives held from picks. */
  proficient(known: Known): Set<string> {
    const held = skillGrants(this.data, [], heldPassives(known)).proficient;
    return new Set([...known.skills, ...this.proficientGranted, ...held]);
  }

  /** Expertise granted without a pick so far (granted or from held passives), where the character is proficient. */
  grantedExpertise(known: Known): Set<string> {
    const proficient = this.proficient(known);
    const held = skillGrants(this.data, [], heldPassives(known)).expertise;
    return new Set([...this.expertiseGranted, ...held].filter((skill) => proficient.has(skill)));
  }

  /** Expertise held now, picked or granted, where the character is proficient. */
  expertise(known: Known): Set<string> {
    const proficient = this.proficient(known);
    return new Set([...known.expertise, ...this.grantedExpertise(known)].filter((skill) => proficient.has(skill)));
  }
}

/** Where a skill granted without a pick comes from. */
export type SkillSource = "race" | "subrace" | "background";

/**
 * Skills granted at character level ≤ `level` by the race rows, the subrace rows (their `boosts` and `passives_added`)
 * and the background's passives, each with its first source in that order. Identity fields that are undecided, outside
 * the game data or unknown grant nothing.
 */
export function grantedSkills(character: Character, data: GameData, level: number): Map<string, SkillSource> {
  const { races, progressions } = data.rules;
  const granted = new Map<string, SkillSource>();
  const add = (skills: string[], source: SkillSource) => {
    for (const skill of skills) if (!granted.has(skill)) granted.set(skill, source);
  };
  const rowSkills = (table: string) =>
    progressions.filter((row) => row.table === table && !row.multiclass && row.level <= level).flatMap((row) => rowSkillGrants(data, row).proficient);

  const { race, subrace } = character;
  if (!isOffData(race) && Object.hasOwn(races, race) && races[race]?.parent === null) {
    add(rowSkills(races[race]?.table ?? ""), "race");
    if (subrace !== null && !isOffData(subrace) && Object.hasOwn(races, subrace) && races[subrace]?.parent === race) {
      add(rowSkills(races[subrace]?.table ?? ""), "subrace");
    }
  }
  add(backgroundSkillGrants(character, data).proficient, "background");
  return granted;
}
