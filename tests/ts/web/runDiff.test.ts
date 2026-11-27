import { describe, expect, it } from "vitest";
import { decodeJson } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Run } from "../../../src/plan/model.ts";
import { runDiff } from "../../../web/src/state/runDiff.ts";

function character(id: string, who: string, classes: string[], choices: Record<string, string[] | "todo">[] = []): Character {
  return {
    id,
    who,
    race: "Human",
    subrace: null,
    background: "Soldier",
    abilities: { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 },
    levels: classes.map((cls, i) => ({ class: cls, choices: choices[i] ?? {} })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
}

function base(): Run {
  return { ...emptyRun("r"), name: "Main", characters: [character("c1", "player", ["Fighter", "Fighter", "Fighter"])] };
}

describe("runDiff", () => {
  it("is empty for the oldest version and for an unchanged run", () => {
    expect(runDiff(null, base())).toEqual([]);
    expect(runDiff(base(), base())).toEqual([]);
  });

  it("reports an origin and a party size change", () => {
    expect(runDiff(base(), { ...base(), origin: "Gale", partySize: 5 })).toEqual([
      { kind: "origin", before: "", after: "Gale" },
      { kind: "partySize", before: "4", after: "5" },
    ]);
  });

  it("reports a rename", () => {
    expect(runDiff(base(), { ...base(), name: "X" })).toEqual([{ kind: "name", before: "Main", after: "X" }]);
  });

  it("reports a subclass pick changed at level 3 with its identifiers", () => {
    const before = base();
    before.characters[0]!.levels[2]!.choices = { "u/0": ["Champion"] };
    const after = structuredClone(before);
    after.characters[0]!.levels[2]!.choices = { "u/0": ["BattleMaster"] };
    expect(runDiff(before, after)).toEqual([{ kind: "choice", character: "player", level: 3, before: "Champion", after: "BattleMaster" }]);
  });

  it("reports picks added and removed as sets, and a todo as no pick", () => {
    const before = base();
    before.characters[0]!.levels[0]!.choices = { "u/1": "todo" };
    const after = structuredClone(before);
    after.characters[0]!.levels[0]!.choices = { "u/1": ["A", "B", "C"] };
    expect(runDiff(before, after)).toEqual([{ kind: "choice", character: "player", level: 1, added: ["A", "B", "C"], removed: [] }]);
    expect(runDiff(after, before)).toEqual([{ kind: "choice", character: "player", level: 1, added: [], removed: ["A", "B", "C"] }]);
  });

  it("reports picks that keep their set but change order or repetition, compared position by position", () => {
    const before = base();
    before.characters[0]!.levels[0]!.choices = { "u/2": ["Strength", "Dexterity"] };
    const swapped = structuredClone(before);
    swapped.characters[0]!.levels[0]!.choices = { "u/2": ["Dexterity", "Strength"] };
    expect(runDiff(before, swapped)).toEqual([{ kind: "choice", character: "player", level: 1, added: ["Dexterity", "Strength"], removed: ["Strength", "Dexterity"] }]);

    const increments = structuredClone(before);
    increments.characters[0]!.levels[0]!.choices = { "u/2": ["Strength", "Strength", "Dexterity"] };
    const moved = structuredClone(before);
    moved.characters[0]!.levels[0]!.choices = { "u/2": ["Strength", "Dexterity", "Dexterity"] };
    expect(runDiff(increments, moved)).toEqual([{ kind: "choice", character: "player", level: 1, before: "Strength", after: "Dexterity" }]);
    // A repeated pick replaced by another counts once on each side.
    const twice = structuredClone(before);
    twice.characters[0]!.levels[0]!.choices = { "u/2": ["Strength", "Strength"] };
    expect(runDiff(twice, before)).toEqual([{ kind: "choice", character: "player", level: 1, before: "Strength", after: "Dexterity" }]);
    expect(runDiff(before, structuredClone(before))).toEqual([]);
  });

  it("gives the ability scores in the game's ability order, whatever the order of the stored keys", () => {
    const before = base();
    const after = structuredClone(before);
    after.characters[0]!.abilities = { Charisma: 8, Wisdom: 8, Intelligence: 8, Constitution: 8, Dexterity: 15, Strength: 10 };
    expect(runDiff(before, after)).toEqual([{ kind: "abilities", character: "player", before: "8/8/8/8/8/8", after: "10/15/8/8/8/8" }]);
    const reordered = structuredClone(before);
    reordered.characters[0]!.abilities = { Charisma: 8, Wisdom: 8, Intelligence: 8, Constitution: 8, Dexterity: 8, Strength: 8 };
    expect(runDiff(before, reordered)).toEqual([]);
  });

  it("reports the party of an act as one change", () => {
    const before = base();
    before.party["2"].active = ["player", "Gale"];
    const after = structuredClone(before);
    after.party["2"].active = ["player", "Astarion"];
    expect(runDiff(before, after)).toEqual([{ kind: "party", act: "2", added: ["Astarion"], removed: ["Gale"] }]);
  });

  it("reports a level's class, difficulty, progress, characters and levels", () => {
    const before = base();
    const after = structuredClone(before);
    after.characters[0]!.levels[1]!.class = "Rogue";
    after.difficulty = { ruleset: "DIFFICULTY_HARD", overrides: {} };
    after.progress = { level: 4, act: 2 };
    expect(runDiff(before, after)).toEqual([
      { kind: "difficulty", before: "", after: "DIFFICULTY_HARD" },
      { kind: "progress", level: 4, before: "1", after: "4" },
      { kind: "progress", act: "2", before: "1", after: "2" },
      { kind: "levelClass", character: "player", level: 2, before: "Fighter", after: "Rogue" },
    ]);

    const grown = structuredClone(before);
    grown.characters[0]!.levels.push({ class: "Fighter", choices: {} });
    grown.characters.push(character("c2", "Gale", ["Wizard"]));
    expect(runDiff(before, grown)).toEqual([
      { kind: "levelAdded", character: "player", level: 4 },
      { kind: "characterAdded", character: "Gale" },
    ]);
    expect(runDiff(grown, before)).toEqual([
      { kind: "levelRemoved", character: "player", level: 4 },
      { kind: "characterRemoved", character: "Gale" },
    ]);
  });

  it("never throws on an off-data or undecided value", () => {
    const before = base();
    const after = structuredClone(before);
    after.characters[0]!.race = { offData: "ModRace" };
    after.characters[0]!.levels[0]!.class = { offData: "ModClass" };
    after.characters[0]!.levels[1]!.choices = { "u/0": { offData: "x" } };
    expect(runDiff(before, after)).toEqual([
      { kind: "race", character: "player", before: "Human", after: "ModRace" },
      { kind: "levelClass", character: "player", level: 1, before: "Fighter", after: "ModClass" },
      { kind: "choice", character: "player", level: 2, after: "x" },
    ]);
  });

  it("compares a version-2 JSON version with a current one", () => {
    const current = base();
    const { difficulty: _difficulty, characters, ...rest } = current;
    const v2 = JSON.stringify({ ...rest, version: 2, difficulty: "Balanced", characters: characters.map(({ equipment: _e, ...c }) => ({ ...c, items: [] })) });
    const older = decodeJson(v2);
    expect(older.version).toBe(4);
    const changes = runDiff(older, { ...current, name: "Later" });
    expect(changes).toContainEqual({ kind: "name", before: "Main", after: "Later" });
  });

  it("reports an equipment change by act and slot, with the item before and after", () => {
    const before = base();
    before.characters[0]!.equipment = { "1": { Breast: "ARM_Old" }, "2": {}, "3": {} };
    const after = structuredClone(before);
    after.characters[0]!.equipment = { "1": { Breast: "ARM_Old" }, "2": { Breast: "ARM_New" }, "3": {} };
    expect(runDiff(before, after)).toEqual([{ kind: "equipment", character: "player", act: "2", slot: "Breast", beforeState: "inherited", after: "ARM_New" }]);
    const swapped = structuredClone(after);
    swapped.characters[0]!.equipment["2"] = { Breast: "ARM_Other" };
    expect(runDiff(after, swapped)).toEqual([{ kind: "equipment", character: "player", act: "2", slot: "Breast", before: "ARM_New", after: "ARM_Other" }]);
  });

  it("tells emptying and inheriting apart", () => {
    const before = base();
    before.characters[0]!.equipment = { "1": { Cloak: "ARM_Cloak" }, "2": { Cloak: "ARM_Cloak" }, "3": {} };
    const emptied = structuredClone(before);
    emptied.characters[0]!.equipment["2"] = { Cloak: null };
    expect(runDiff(before, emptied)).toEqual([{ kind: "equipment", character: "player", act: "2", slot: "Cloak", before: "ARM_Cloak", afterState: "empty" }]);
    const inherited = structuredClone(before);
    inherited.characters[0]!.equipment["2"] = {};
    expect(runDiff(before, inherited)).toEqual([{ kind: "equipment", character: "player", act: "2", slot: "Cloak", before: "ARM_Cloak", afterState: "inherited" }]);
    expect(runDiff(emptied, inherited)).toEqual([{ kind: "equipment", character: "player", act: "2", slot: "Cloak", beforeState: "empty", afterState: "inherited" }]);
  });

  it("a prepared-spells change lists added and removed spells at its level, with its class and class level", () => {
    const before = base();
    before.characters[0]!.levels = [{ class: "Cleric", choices: {} }, { class: "Fighter", choices: {} }, { class: "Cleric", choices: {}, prepared: ["A", "B"] }];
    const after = structuredClone(before);
    after.characters[0]!.levels[2]!.prepared = ["B", "C"];
    expect(runDiff(before, after)).toEqual([{ kind: "prepared", character: "player", level: 3, class: "Cleric", classLevel: 2, added: ["C"], removed: ["A"] }]);
  });

  it("a prepared list switching between own and inherited is reported with its mode", () => {
    const before = base();
    before.characters[0]!.levels[1]!.prepared = ["A"];
    const after = structuredClone(before);
    delete after.characters[0]!.levels[1]!.prepared;
    expect(runDiff(before, after)).toEqual([{ kind: "prepared", character: "player", level: 2, class: "Fighter", classLevel: 2, mode: "inherited", added: [], removed: ["A"] }]);
    expect(runDiff(after, before)).toEqual([{ kind: "prepared", character: "player", level: 2, class: "Fighter", classLevel: 2, mode: "own", added: ["A"], removed: [] }]);
  });
});
