import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { coverage } from "../../src/engine/coverage.ts";
import { resolve } from "../../src/engine/progression.ts";
import { rulesetEffects } from "../../src/engine/difficulty.ts";
import { validate } from "../../src/engine/validate.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Character, Difficulty, Run } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

const SCORES = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };

function character(id: string, classes: Character["levels"][number]["class"][]): Character {
  return { id, who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: "", abilities: { ...SCORES }, levels: classes.map((cls) => ({ class: cls, choices: {} })), items: [], notes: "" };
}

function runOf(characters: Character[], ruleset: string, overrides: Difficulty["overrides"] = {}): Run {
  const run = emptyRun("r1");
  run.characters = characters;
  run.party["1"].active = characters.map((c) => c.id);
  run.difficulty = { ruleset, overrides };
  return run;
}

const DEFAULTS = { multiclass: true, proficiencyBonus: 0, honourStats: false };

describe("rulesetEffects", () => {
  it("reads the ruleset's values from the game data", () => {
    expect(rulesetEffects({ ruleset: "DIFFICULTY_EASY", overrides: {} }, data)).toEqual({ known: true, multiclass: false, proficiencyBonus: 2, honourStats: false });
    expect(rulesetEffects({ ruleset: "RULESET_HONOUR", overrides: {} }, data)).toEqual({ known: true, ...DEFAULTS, honourStats: true });
    expect(rulesetEffects({ ruleset: "DIFFICULTY_MEDIUM", overrides: {} }, data)).toEqual({ known: true, ...DEFAULTS });
  });

  it("uses the modifiers' defaults for an undecided ruleset", () => {
    expect(rulesetEffects({ ruleset: "", overrides: {} }, data)).toEqual({ known: true, ...DEFAULTS });
  });

  it("applies the overrides over the ruleset", () => {
    expect(rulesetEffects({ ruleset: "RULESET_LARIAN", overrides: { MULTICLASSING: false, PROFICIENCY_BONUS: -1 } }, data)).toEqual({ known: true, multiclass: false, proficiencyBonus: -1, honourStats: false });
  });

  it("marks a ruleset outside the data as unknown and uses the defaults", () => {
    expect(rulesetEffects({ ruleset: "Nightmare", overrides: {} }, data)).toEqual({ known: false, ...DEFAULTS });
  });

  it("ignores an override of the wrong type, out of range or outside the build modifiers", () => {
    const effects = rulesetEffects({ ruleset: "DIFFICULTY_EASY", overrides: { MULTICLASSING: 1, PROFICIENCY_BONUS: true, HONOUR_STATS: 3, SOMETHING_ELSE: true } }, data);
    expect(effects).toEqual({ known: true, multiclass: false, proficiencyBonus: 2, honourStats: false });
    expect(rulesetEffects({ ruleset: "", overrides: { PROFICIENCY_BONUS: 9 } }, data).proficiencyBonus).toBe(0);
  });
});

describe("validate under a ruleset", () => {
  const multiclassIssues = (run: Run) => validate(run, data).issues.filter((i) => i.code === "multiclassDisabled");

  it("lists a multiclass level the ruleset forbids, without touching the choices", () => {
    const run = runOf([character("p", ["Ranger", "Ranger", "Ranger", "Ranger", "Ranger", "Rogue"])], "DIFFICULTY_EASY");
    const before = structuredClone(run);
    expect(multiclassIssues(run)).toEqual([{ severity: "invalid", code: "multiclassDisabled", character: "p", level: 6, slot: null, params: { class: "Rogue" } }]);
    expect(run).toEqual(before);
    expect(validate(run, data).status).toBe("invalid");
  });

  it("accepts the same multiclass under a ruleset that allows it", () => {
    const run = runOf([character("p", ["Ranger", "Ranger", "Ranger", "Ranger", "Ranger", "Rogue"])], "DIFFICULTY_MEDIUM");
    expect(multiclassIssues(run)).toEqual([]);
    expect(multiclassIssues({ ...run, difficulty: { ruleset: "DIFFICULTY_MEDIUM", overrides: { MULTICLASSING: false } } })).toHaveLength(1);
  });

  it("does not flag a level whose class is undecided or outside the data", () => {
    const run = runOf([character("p", ["Ranger", "", { offData: "ModClass" }]), character("q", ["", "Rogue"])], "DIFFICULTY_EASY");
    expect(multiclassIssues(run)).toEqual([]);
  });
});

describe("coverage under a ruleset", () => {
  it("adds the ruleset's proficiency bonus to a proficient member's skill value", () => {
    const ranger = character("r", ["Ranger"]);
    const slot = resolve(ranger, data).levels[0]!.slots.find((s) => s.selector.function === "SelectSkills")!;
    ranger.levels[0]!.choices[slot.id] = ["Stealth", "Perception", "Survival"];
    const best = (ruleset: string, skill: string) => coverage(runOf([ranger], ruleset), data, 1).find((s) => s.skill === skill)!.best!;
    expect(best("DIFFICULTY_MEDIUM", "Stealth").proficient).toBe(true);
    expect(best("DIFFICULTY_EASY", "Stealth").value).toBe(best("DIFFICULTY_MEDIUM", "Stealth").value + 2);
    expect(best("DIFFICULTY_EASY", "Arcana").value).toBe(best("DIFFICULTY_MEDIUM", "Arcana").value);
  });
});
