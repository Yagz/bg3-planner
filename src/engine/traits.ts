import type { GameData } from "../data/types.ts";
import type { Ability } from "../plan/model.ts";
import { asAbility } from "./casting.ts";
import { skillGrants } from "./skills.ts";

/** Something a race, a subrace or a background gives, seen at the character level that gives it. */
export type Trait = { level: number } & (
  | { kind: "passive"; id: string }
  | { kind: "skill"; skill: string }
  | { kind: "speed"; meters: number; added: boolean }
  | { kind: "hpPerLevel" }
  | { kind: "spells"; spells: string[]; ability: Ability | null }
  | { kind: "choice"; function: "SelectSpells" | "SelectSkills" | "SelectPassives"; count: number; ability: Ability | null; list: string }
  /** A resource counter such as a racial spell's charges; the interface does not display it, the spell it charges is already a `spells` trait. */
  | { kind: "resource"; resource: string; amount: number }
  | { kind: "unknownBoost"; boost: string }
);

const SKILL = /^ProficiencyBonus\(Skill,\s*(\w+)\)$/;
const MOVEMENT = /^ActionResource\(Movement,\s*([\d.]+),\s*0\)$/;
const RESOURCE = /^ActionResource\((\w+),\s*([\d.]+),\s*0\)$/;

/**
 * What the race (or subrace) of that name gives, from the non-multiclass rows of its table, by level then row order: the
 * passives it adds (technical ones left out), its boosts, the spells it grants and the choices it offers. A boost of an
 * unrecognised form is reported as `unknownBoost`, never guessed. Empty for an unknown name.
 */
export function identityTraits(data: GameData, race: string): Trait[] {
  const { races, progressions, passives, lists } = data.rules;
  if (!Object.hasOwn(races, race)) return [];
  const def = races[race];
  if (def === undefined) return [];
  const added = def.parent !== null;
  const rows = progressions.filter((row) => row.type === "race" && row.table === def.table && !row.multiclass);
  rows.sort((a, b) => a.level - b.level);
  const traits: Trait[] = [];
  for (const row of rows) {
    const { level } = row;
    for (const id of row.passives_added) if (!Object.hasOwn(passives, id) || passives[id]?.technical !== true) traits.push({ level, kind: "passive", id });
    for (const boost of row.boosts) {
      const skill = SKILL.exec(boost)?.[1];
      const meters = MOVEMENT.exec(boost)?.[1];
      const resource = RESOURCE.exec(boost);
      if (skill !== undefined) traits.push({ level, kind: "skill", skill });
      else if (meters !== undefined) traits.push({ level, kind: "speed", meters: Number(meters), added });
      else if (resource !== null && resource[1] !== "Movement") traits.push({ level, kind: "resource", resource: resource[1] as string, amount: Number(resource[2]) });
      else if (boost === "IncreaseMaxHP(Level)") traits.push({ level, kind: "hpPerLevel" });
      else traits.push({ level, kind: "unknownBoost", boost });
    }
    for (const selector of row.selectors) {
      if (selector.function === "AddSpells") {
        const spells = Object.hasOwn(lists, selector.list) ? (lists[selector.list]?.items ?? []) : [];
        traits.push({ level, kind: "spells", spells: [...spells], ability: asAbility(selector.ability) });
      } else if (selector.function === "SelectSpells") {
        traits.push({ level, kind: "choice", function: selector.function, count: selector.count, ability: asAbility(selector.ability), list: selector.list });
      } else if (selector.function === "SelectSkills" || selector.function === "SelectPassives") {
        traits.push({ level, kind: "choice", function: selector.function, count: selector.count, ability: null, list: selector.list });
      }
    }
  }
  return traits;
}

/** The skills the background's passives grant, as level-1 `skill` traits; empty when the background is unknown. */
export function backgroundTraits(data: GameData, background: string): Trait[] {
  const { backgrounds } = data.rules;
  if (!Object.hasOwn(backgrounds, background)) return [];
  const names = backgrounds[background]?.passives ?? [];
  return skillGrants(data, [], names).proficient.map((skill): Trait => ({ level: 1, kind: "skill", skill }));
}
