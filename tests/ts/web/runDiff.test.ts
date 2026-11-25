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
    items: [],
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
    const reordered = structuredClone(after);
    reordered.characters[0]!.levels[0]!.choices = { "u/1": ["C", "B", "A"] };
    expect(runDiff(after, reordered)).toEqual([]);
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

  it("compares a version-2 JSON version with a version-3 one", () => {
    const v3 = base();
    const { difficulty: _difficulty, ...rest } = v3;
    const v2 = JSON.stringify({ ...rest, version: 2, difficulty: "Balanced" });
    const older = decodeJson(v2);
    expect(older.version).toBe(3);
    const changes = runDiff(older, { ...v3, name: "Later" });
    expect(changes).toContainEqual({ kind: "name", before: "Main", after: "Later" });
  });
});
