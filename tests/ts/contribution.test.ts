import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData, Selector } from "../../src/data/types.ts";
import { abilityTotals } from "../../src/engine/abilities.ts";
import { contribution } from "../../src/engine/contribution.ts";
import { coverage } from "../../src/engine/coverage.ts";
import { resolve } from "../../src/engine/progression.ts";
import { ABILITIES, emptyRun } from "../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../src/plan/model.ts";

let data: GameData;
let hauntedOne: string;
beforeAll(async () => {
  data = await loadGameData("data/larian");
  hauntedOne = Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_HauntedOne")) ?? "";
});

const SCORES = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };

/** A Haunted One Lightfoot Halfling; `picks` maps a selector function to the picks made at its first slot per level. */
function character(id: string, classes: string[], picks: Partial<Record<Selector["function"], string[]>>[], abilities = SCORES): Character {
  const c: Character = { id, who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: hauntedOne, abilities: { ...abilities }, levels: classes.map((cls) => ({ class: cls, choices: {} })), items: [], notes: "" };
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
  run.difficulty = { ruleset: "DIFFICULTY_MEDIUM", overrides: {} };
  return run;
}

describe("contribution", () => {
  // Ranger: Stealth, Perception, Survival (+ Haunted One: Intimidation, Medicine). Rogue: Stealth, Acrobatics, Deception, Perception, expertise in Stealth.
  const ranger = () => character("r", ["Ranger"], [{ SelectSkills: ["Stealth", "Perception", "Survival"], SelectAbilityBonus: ["Dexterity", "Wisdom"] }], { ...SCORES, Strength: 10 });
  const rogue = () => character("g", ["Rogue"], [{ SelectSkills: ["Stealth", "Acrobatics", "Deception", "Perception"], SelectSkillsExpertise: ["Stealth", "Perception"], SelectAbilityBonus: ["Dexterity", "Charisma"] }], { ...SCORES, Charisma: 12 });

  it("lists the skills only one member is proficient in, the skills where a member is best, and the abilities where one is highest", () => {
    const r = ranger();
    const g = rogue();
    const run = runOf([r, g]);
    const result = contribution(run, data, 1);
    expect([...result.keys()]).toEqual(["r", "g"]);
    expect(result.get("r")!.only.sort()).toEqual(["Survival"]);
    expect(result.get("g")!.only.sort()).toEqual(["Acrobatics", "Deception"]);
    // Both Haunted Ones: Intimidation and Medicine are shared, so in nobody's `only`.

    // Shared proficiencies with a strictly higher value: the Ranger's Wisdom wins Medicine, the Rogue's expertise wins
    // Stealth and Perception and its Charisma Intimidation. No pill for skills nobody is proficient in.
    expect(result.get("r")!.best.sort()).toEqual(["Medicine"]);
    expect(result.get("g")!.best.sort()).toEqual(["Intimidation", "Perception", "Stealth"]);

    const totals = { r: abilityTotals(r, data, 1), g: abilityTotals(g, data, 1) };
    for (const [id, other] of [["r", "g"], ["g", "r"]] as const) {
      const expected = ABILITIES.filter((a) => totals[id][a] > totals[other][a]);
      expect(result.get(id)!.highest).toEqual(expected);
    }
    expect(result.get("r")!.highest).toContain("Strength");
    expect(result.get("r")!.highest).toContain("Wisdom");
    expect(result.get("g")!.highest).toContain("Charisma");
  });

  it("gives a tied ability to neither member", () => {
    const r = ranger();
    const g = rogue();
    const totals = { r: abilityTotals(r, data, 1), g: abilityTotals(g, data, 1) };
    expect(totals.r.Dexterity).toBe(totals.g.Dexterity);
    const result = contribution(runOf([r, g]), data, 1);
    expect(result.get("r")!.highest).not.toContain("Dexterity");
    expect(result.get("g")!.highest).not.toContain("Dexterity");
  });

  it("gives no pill for a skill no active member is proficient in, even to the member with the highest value", () => {
    const r = ranger();
    const g = rogue();
    const run = runOf([r, g]);
    const athletics = coverage(run, data, 1).find((s) => s.skill === "Athletics")!;
    expect(athletics.proficient).toEqual([]);
    expect(athletics.best?.character).toBe("r");
    const result = contribution(run, data, 1);
    expect(result.get("r")!.best).not.toContain("Athletics");
    expect(result.get("g")!.best).not.toContain("Athletics");
  });

  it("gives a skill where two members tie on the best value to neither of them", () => {
    const r = ranger();
    const g = character("g", ["Rogue"], [{ SelectSkills: ["Stealth", "Acrobatics", "Deception", "Perception"], SelectSkillsExpertise: ["Stealth", "Perception"], SelectAbilityBonus: ["Dexterity", "Charisma"] }], { ...SCORES, Charisma: 10 });
    const run = runOf([r, g]);
    const intimidation = coverage(run, data, 1).find((s) => s.skill === "Intimidation")!;
    expect(intimidation.proficient).toEqual(["r", "g"]);
    // Charisma 10 and 11 give the same modifier: a tie, which `coverage().best` still breaks for the first member.
    expect(intimidation.best?.character).toBe("r");
    const result = contribution(run, data, 1);
    expect(result.get("r")!.best).not.toContain("Intimidation");
    expect(result.get("g")!.best).not.toContain("Intimidation");
  });

  it("covers only the active party, and compares a lone member with nobody", () => {
    const result = contribution(runOf([ranger()], [rogue()]), data, 1);
    expect([...result.keys()]).toEqual(["r"]);
    expect(result.get("r")!.only).toContain("Stealth");
    // Nobody to compare with: no best skill, no highest ability.
    expect(result.get("r")!.best).toEqual([]);
    expect(result.get("r")!.highest).toEqual([]);
    expect(contribution(runOf([]), data, 1).size).toBe(0);
  });
});
