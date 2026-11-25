import { beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import {
  addLevel,
  clearChoice,
  previewNeeded,
  removeLastLevel,
  replaceCharacter,
  setAbilities,
  setChoice,
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
    items: [],
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

  it("adds a level with its class to decide, and removes the last one but never the only one", () => {
    const added = addLevel(ranger());
    expect(added.levels).toHaveLength(4);
    expect(added.levels[3]).toEqual({ class: "", choices: {} });
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

  it("asks for the preview when a class change leaves picks under slots that no longer exist", () => {
    const before = ranger();
    const preview = previewNeeded(before, setLevelClass(before, 2, "Wizard"), runOf(before), data);
    expect(preview?.slotsRemoved.map((pick) => pick.slot)).toContain(spellSlot(before));
  });
});
