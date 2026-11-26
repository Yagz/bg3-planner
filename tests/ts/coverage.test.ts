import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData, Selector } from "../../src/data/types.ts";
import { abilityTotals } from "../../src/engine/abilities.ts";
import { characterSkillValues, coverage, skillProficiencies } from "../../src/engine/coverage.ts";
import { resolve } from "../../src/engine/progression.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../src/plan/model.ts";

let data: GameData;
let hauntedOne: string;
beforeAll(async () => {
  data = await loadGameData("data/larian");
  hauntedOne = Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_HauntedOne")) ?? "";
});

const SCORES = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };

/** A Haunted One Lightfoot Halfling; `picks` maps a selector function to the picks made at its first slot per level. */
function character(id: string, classes: string[], picks: Partial<Record<Selector["function"], string[]>>[]): Character {
  const c: Character = { id, who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: hauntedOne, abilities: { ...SCORES }, levels: classes.map((cls) => ({ class: cls, choices: {} })), equipment: { "1": {}, "2": {}, "3": {} }, notes: "" };
  for (const level of resolve(c, data).levels) {
    const choices: Record<string, Choice> = c.levels[level.level - 1]!.choices;
    for (const [fn, value] of Object.entries(picks[level.level - 1] ?? {})) {
      const slot = level.slots.find((s) => s.selector.function === fn);
      if (slot === undefined) throw new Error(`no ${fn} at level ${level.level}`);
      choices[slot.id] = value;
    }
  }
  return c;
}

function runOf(active: Character[], others: Character[] = []): Run {
  const run = emptyRun("r1");
  run.characters = [...active, ...others];
  run.party["1"].active = active.map((c) => c.id);
  return run;
}

const mod = (c: Character, ability: keyof typeof SCORES, level: number) => Math.floor((abilityTotals(c, data, level)[ability] - 10) / 2);

describe("coverage", () => {
  it("counts background and picked skills of a Haunted One Halfling Ranger level 1", () => {
    const ranger = character("r", ["Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);
    const result = coverage(runOf([ranger]), data, 1);
    expect(result.map((s) => s.skill)).toEqual(Object.keys(data.skills));
    const proficient = result.filter((s) => s.best?.proficient).map((s) => s.skill);
    expect(proficient.sort()).toEqual(["Intimidation", "Medicine", "Perception", "Stealth", "Survival"]);

    const stealth = result.find((s) => s.skill === "Stealth")!;
    expect(stealth).toEqual({ skill: "Stealth", ability: "Dexterity", proficient: ["r"], best: { character: "r", value: mod(ranger, "Dexterity", 1) + 2, proficient: true, expertise: false } });
    expect(mod(ranger, "Dexterity", 1)).toBe(3);
    const arcana = result.find((s) => s.skill === "Arcana")!;
    expect(arcana.best).toEqual({ character: "r", value: mod(ranger, "Intelligence", 1), proficient: false, expertise: false });
  });

  it("doubles the proficiency bonus with expertise, and takes the best member", () => {
    const rogue = character("g", ["Rogue"], [{ SelectSkills: ["Stealth", "Acrobatics", "Deception", "Perception"], SelectSkillsExpertise: ["Stealth", "Perception"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);
    const ranger = character("r", ["Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);
    const result = coverage(runOf([ranger, rogue]), data, 1);
    expect(result.find((s) => s.skill === "Stealth")!.best).toEqual({ character: "g", value: mod(rogue, "Dexterity", 1) + 4, proficient: true, expertise: true });
    expect(result.find((s) => s.skill === "Survival")!.best?.character).toBe("r");
  });

  it("uses the proficiency bonus of the truncated character level and only the active party", () => {
    const classes = ["Ranger", "Ranger", "Ranger", "Ranger", "Ranger"];
    const ranger = character("r", classes, [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);
    const rogue = character("g", ["Rogue"], [{ SelectSkills: ["Stealth", "Acrobatics", "Deception", "Perception"], SelectSkillsExpertise: ["Stealth", "Perception"] }]);
    const run = runOf([ranger], [rogue]);
    expect(coverage(run, data, 5).find((s) => s.skill === "Stealth")!.best).toEqual({ character: "r", value: 3 + 3, proficient: true, expertise: false });
    expect(coverage(run, data, 4).find((s) => s.skill === "Stealth")!.best?.value).toBe(3 + 2);
    expect(coverage(run, data, 12).find((s) => s.skill === "Deception")!.best?.character).toBe("r");
    expect(coverage(runOf([]), data, 12).every((s) => s.best === null)).toBe(true);
  });

  it("counts held passives and feats' passives that grant proficiency", () => {
    // FavoredEnemy_BountyHunter grants Investigation; the Actor feat gives Deception and Performance expertise.
    const classes = ["Ranger", "Ranger", "Ranger", "Ranger"];
    const ranger = character("r", classes, [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectPassives: ["FavoredEnemy_BountyHunter"] }]);
    ranger.levels[3]!.choices["feat:4"] = ["Actor"];
    const result = coverage(runOf([ranger]), data, 4);
    expect(result.find((s) => s.skill === "Investigation")!.best?.proficient).toBe(true);
    expect(result.find((s) => s.skill === "Deception")!.best).toMatchObject({ proficient: true, expertise: true });
    expect(coverage(runOf([ranger]), data, 3).find((s) => s.skill === "Deception")!.best?.proficient).toBe(false);
  });

  it("counts what is known of a character with an identity field outside the game data", () => {
    const ranger = character("r", ["Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"] }]);
    ranger.background = { offData: "ModdedBackground" };
    const result = coverage(runOf([ranger]), data, 1);
    expect(result.find((s) => s.skill === "Medicine")!.best?.proficient).toBe(false);
    expect(result.find((s) => s.skill === "Stealth")!.best?.proficient).toBe(true);
  });

  it("counts a skill a race row grants by its own boosts (Elf Perception) with no pick", () => {
    const elf: Character = { ...character("e", ["Fighter"], []), race: "Elf", subrace: "Elf_HighElf" };
    expect(skillProficiencies(elf, data).proficient).toContain("Perception");
  });

  it("counts Knowledge Domain expertise picks as proficiency and expertise", () => {
    const cleric: Character = { ...character("k", ["Cleric"], []), race: "Human", subrace: null };
    cleric.levels[0]!.choices["subclass:Cleric"] = ["KnowledgeDomain"];
    const slot = resolve(cleric, data).levels[0]!.slots.find((s) => s.selector.function === "SelectSkillsExpertise")!;
    cleric.levels[0]!.choices[slot.id] = ["Arcana", "Nature"];
    const { proficient, expertise } = skillProficiencies(cleric, data);
    expect([...proficient]).toEqual(expect.arrayContaining(["Arcana", "Nature"]));
    expect([...expertise].sort()).toEqual(["Arcana", "Nature"]);
  });

  describe("who is proficient", () => {
    const soldier = () => Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_Soldier"))!;
    /** A Soldier Fighter (no Medicine) with Wisdom `wisdom`, and a Haunted One Fighter (Medicine) with Wisdom 10. */
    const pair = (wisdom: number) => {
      const fighter = character("f", ["Fighter"], [{ SelectSkills: ["Athletics", "Perception"] }]);
      fighter.background = soldier();
      fighter.abilities = { ...fighter.abilities, Wisdom: wisdom };
      const haunted = character("h", ["Fighter"], [{ SelectSkills: ["Athletics", "Perception"] }]);
      haunted.abilities = { ...haunted.abilities, Wisdom: 10 };
      return { fighter, haunted };
    };

    it("breaks a tie toward the proficient member, even listed after an unproficient one", () => {
      const { fighter, haunted } = pair(15);
      const medicine = coverage(runOf([fighter, haunted]), data, 1).find((s) => s.skill === "Medicine")!;
      expect(medicine.proficient).toEqual(["h"]);
      expect(medicine.best).toEqual({ character: "h", value: 0 + 2, proficient: true, expertise: false });
    });

    it("lists the proficient members even when an unproficient member's modifier is higher", () => {
      const { fighter, haunted } = pair(17);
      const medicine = coverage(runOf([fighter, haunted]), data, 1).find((s) => s.skill === "Medicine")!;
      expect(medicine.proficient).toEqual(["h"]);
      expect(medicine.best).toEqual({ character: "f", value: 3, proficient: false, expertise: false });
      expect(coverage(runOf([fighter]), data, 1).find((s) => s.skill === "Medicine")!.proficient).toEqual([]);
    });
  });
});

describe("characterSkillValues", () => {
  const ranger = () => character("r", ["Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);

  it("gives every skill of the game in its order, with the proficiency bonus on proficient ones", () => {
    const values = characterSkillValues(ranger(), data, 1, 0);
    expect(values.map((v) => v.skill)).toEqual(Object.keys(data.skills));
    expect(values).toHaveLength(18);
    expect(values.find((v) => v.skill === "Stealth")).toEqual({ skill: "Stealth", ability: "Dexterity", value: 5, proficient: true, expertise: false });
    expect(values.find((v) => v.skill === "Arcana")).toMatchObject({ value: -1, proficient: false });
  });

  it("adds the ruleset's bonus to the proficiency bonus of proficient skills only", () => {
    const values = characterSkillValues(ranger(), data, 1, 1);
    expect(values.find((v) => v.skill === "Stealth")?.value).toBe(6);
    expect(values.find((v) => v.skill === "Arcana")?.value).toBe(-1);
  });

  it("cuts the character to the level asked", () => {
    const c = character("r", ["Ranger", "Ranger", "Ranger", "Ranger", "Ranger", "Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }]);
    // Stealth: Dexterity modifier 3 plus the proficiency bonus of the reached level (2 up to level 4, 3 from 5).
    expect(characterSkillValues(c, data, 4, 0).find((v) => v.skill === "Stealth")?.value).toBe(3 + 2);
    expect(characterSkillValues(c, data, 6, 0).find((v) => v.skill === "Stealth")?.value).toBe(3 + 3);
    expect(characterSkillValues(c, data, 12, 0).find((v) => v.skill === "Stealth")?.value).toBe(3 + 3);
  });
});
