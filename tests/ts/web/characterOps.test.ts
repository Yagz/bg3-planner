import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import {
  addLevel,
  clearChoice,
  previewNeeded,
  inheritEquipment,
  removeLastLevel,
  replaceCharacter,
  setAbilities,
  setChoice,
  setEquipment,
  setIdentity,
  setLevelClass,
} from "../../../web/src/state/characterOps.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});

/** A Lightfoot Halfling Gloom Stalker, Ranger 1-3, its level-1 skills and level-2 spells picked. */
function ranger(): Character {
  const c: Character = {
    id: "ranger",
    who: "player",
    race: "Halfling",
    subrace: "Halfling_Lightfoot",
    background: Object.keys(data.rules.backgrounds)[0]!,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: [1, 2, 3].map(() => ({ class: "Ranger", choices: {} as Record<string, Choice> })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
  const levels = resolve(c, data).levels;
  c.levels[0]!.choices[levels[0]!.slots.find((s) => s.selector.function === "SelectSkills")!.id] = ["Stealth", "Perception", "Survival"];
  c.levels[1]!.choices[spellSlot(c)] = ["Target_HuntersMark", "Target_CureWounds"];
  c.levels[2]!.choices[subclassSlot("Ranger")] = ["GloomStalker"];
  return c;
}

function spellSlot(c: Character): string {
  return resolve(c, data).levels[1]!.slots.find((s) => s.selector.function === "SelectSpells")!.id;
}

function runOf(c: Character): Run {
  const run = emptyRun("r");
  run.characters = [c];
  run.party["1"].active = [c.id];
  return run;
}

describe("setChoice", () => {
  it("stores one slot and never touches the other slots, levels or the input", () => {
    const before = ranger();
    const snapshot = structuredClone(before);
    const after = setChoice(before, 2, spellSlot(before), ["Target_Goodberry", "Target_Jump"]);
    expect(after.levels[1]!.choices[spellSlot(before)]).toEqual(["Target_Goodberry", "Target_Jump"]);
    for (const [slot, choice] of Object.entries(before.levels[1]!.choices)) if (slot !== spellSlot(before)) expect(after.levels[1]!.choices[slot]).toEqual(choice);
    expect(Object.keys(after.levels[1]!.choices).sort()).toEqual(Object.keys(before.levels[1]!.choices).sort());
    expect(after.levels[0]).toEqual(before.levels[0]);
    expect(after.levels[2]).toEqual(before.levels[2]);
    expect(before).toEqual(snapshot);
  });

  it("stores a value outside the game data as written", () => {
    const after = setChoice(ranger(), 2, "any/0", { offData: "Mod spell" });
    expect(after.levels[1]!.choices["any/0"]).toEqual({ offData: "Mod spell" });
  });

  it("refuses a level the character does not have", () => {
    expect(() => setChoice(ranger(), 4, "any/0", [])).toThrow();
  });
});

describe("other character operations", () => {
  it("clears one slot only", () => {
    const before = ranger();
    const after = clearChoice(before, 3, subclassSlot("Ranger"));
    expect(Object.hasOwn(after.levels[2]!.choices, subclassSlot("Ranger"))).toBe(false);
    expect(after.levels[1]).toEqual(before.levels[1]);
  });

  it("changes one identity field, keeping the subrace of another race for the engine to flag", () => {
    const after = setIdentity(ranger(), "race", "Elf");
    expect(after.race).toBe("Elf");
    expect(after.subrace).toBe("Halfling_Lightfoot");
    expect(setIdentity(ranger(), "subrace", null).subrace).toBeNull();
    expect(setIdentity(ranger(), "background", { offData: "Mod background" }).background).toEqual({ offData: "Mod background" });
    expect(() => setIdentity(ranger(), "race", null)).toThrow();
  });

  it("sets the base scores and the class of a level, keeping the level's picks", () => {
    const scores = { Strength: 15, Dexterity: 15, Constitution: 15, Intelligence: 8, Wisdom: 8, Charisma: 8 };
    expect(setAbilities(ranger(), scores).abilities).toEqual(scores);
    const after = setLevelClass(ranger(), 3, "Rogue");
    expect(after.levels[2]).toEqual({ class: "Rogue", choices: { [subclassSlot("Ranger")]: ["GloomStalker"] } });
  });

  it("adds a level that continues the last level's class as is, with no picks, and removes the last one but never the only one", () => {
    const added = addLevel(ranger());
    expect(added.levels).toHaveLength(4);
    expect(added.levels[3]).toEqual({ class: "Ranger", choices: {} });
    const undecided: Character = { ...ranger(), levels: [...ranger().levels, { class: "", choices: {} }] };
    expect(addLevel(undecided).levels[4]).toEqual({ class: "", choices: {} });
    const outside: Character = { ...ranger(), levels: [...ranger().levels, { class: { offData: "X" }, choices: { a: ["b"] } }] };
    expect(addLevel(outside).levels[4]).toEqual({ class: { offData: "X" }, choices: {} });
    expect(addLevel(outside).levels[4]!.class).not.toBe(outside.levels[3]!.class);
    expect(removeLastLevel(added).levels).toEqual(ranger().levels);
    expect(() => removeLastLevel({ ...ranger(), levels: [{ class: "Ranger", choices: {} }] })).toThrow();
    let full = ranger();
    while (full.levels.length < 12) full = addLevel(full);
    expect(() => addLevel(full)).toThrow();
  });

  it("replaces a character of the run by id", () => {
    const run = runOf(ranger());
    const changed = setIdentity(ranger(), "race", "Elf");
    expect(replaceCharacter(run, changed).characters).toEqual([changed]);
    expect(() => replaceCharacter(run, { ...changed, id: "other" })).toThrow();
  });
});

describe("previewNeeded", () => {
  it("lets a spell replaced by another at the same level apply directly", () => {
    const before = ranger();
    const after = setChoice(before, 2, spellSlot(before), ["Target_Goodberry", "Target_CureWounds"]);
    expect(previewNeeded(before, after, runOf(before), data)).toBeNull();
  });

  it("asks for the preview when a subclass change gains and loses features", () => {
    const before = ranger();
    const after = setChoice(before, 3, subclassSlot("Ranger"), ["Hunter"]);
    const preview = previewNeeded(before, after, runOf(before), data);
    expect(preview).not.toBeNull();
    expect(preview!.gained.length + preview!.lost.length).toBeGreaterThan(0);
  });

  it("applies a first pick directly: a first subclass, a first race, the class of a new level", () => {
    const noSubclass = clearChoice(ranger(), 3, subclassSlot("Ranger"));
    expect(previewNeeded(noSubclass, setChoice(noSubclass, 3, subclassSlot("Ranger"), ["Hunter"]), runOf(noSubclass), data)).toBeNull();
    const noRace = setIdentity(setIdentity(ranger(), "race", ""), "subrace", null);
    expect(previewNeeded(noRace, setIdentity(noRace, "race", "Human"), runOf(noRace), data)).toBeNull();
    const added: Character = { ...ranger(), levels: [...ranger().levels, { class: "", choices: {} }] };
    expect(previewNeeded(added, setLevelClass(added, 4, "Ranger"), runOf(added), data)).toBeNull();
  });

  it("applies an ability step directly even when it goes over the point-buy budget", () => {
    const before = ranger();
    const after = setAbilities(before, { ...before.abilities, Strength: 15 });
    expect(previewNeeded(before, after, runOf(before), data)).toBeNull();
  });

  it("asks for the preview when an ability change makes a later feat impossible", () => {
    const before: Character = { ...ranger(), abilities: { Strength: 8, Dexterity: 13, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 12 } };
    before.levels = [...before.levels, { class: "Ranger", choices: { "feat:4": ["DefensiveDuelist"] } }];
    const preview = previewNeeded(before, setAbilities(before, { ...before.abilities, Dexterity: 12, Charisma: 13 }), runOf(before), data);
    expect(preview?.newlyInvalid.map((issue) => [issue.code, issue.level, issue.slot])).toEqual([["requirementNotMet", 4, "feat:4"]]);
  });

  it("asks for the preview when removing a last level that holds picks, even one that grants nothing", () => {
    const before: Character = { ...ranger(), levels: ranger().levels.slice(0, 2) };
    const preview = previewNeeded(before, removeLastLevel(before), runOf(before), data);
    expect(preview?.gained).toEqual([]);
    expect(preview?.lost).toEqual([]);
    expect(preview?.slotsRemoved).toEqual([{ level: 2, slot: spellSlot(before), choice: ["Target_HuntersMark", "Target_CureWounds"] }]);
  });

  it("asks for the preview when a class change leaves picks under slots that no longer exist", () => {
    const before = ranger();
    const preview = previewNeeded(before, setLevelClass(before, 2, "Wizard"), runOf(before), data);
    expect(preview?.slotsRemoved.map((pick) => pick.slot)).toContain(spellSlot(before));
  });
});

describe("equipment operations", () => {
  it("setEquipment null stores null; inheritEquipment deletes the key", () => {
    const base = ranger();
    const set = setEquipment(base, "2", "Helmet", "ARM_Helmet");
    expect(set.equipment["2"]).toEqual({ Helmet: "ARM_Helmet" });
    expect(base.equipment["2"]).toEqual({});
    const emptied = setEquipment(set, "2", "Helmet", null);
    expect(Object.hasOwn(emptied.equipment["2"], "Helmet")).toBe(true);
    expect(emptied.equipment["2"].Helmet).toBeNull();
    const kept = setEquipment(emptied, "2", "Cloak", "CL");
    const inherited = inheritEquipment(kept, "2", "Helmet");
    expect(Object.hasOwn(inherited.equipment["2"], "Helmet")).toBe(false);
    expect(inherited.equipment["2"].Cloak).toBe("CL");
    expect(inherited.equipment["1"]).toEqual({});
  });
});
