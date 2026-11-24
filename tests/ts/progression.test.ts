import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { resolve } from "../../src/engine/progression.ts";
import type { Character, Choice, Level } from "../../src/plan/model.ts";

let data: GameData;
let background: string;
beforeAll(async () => {
  data = await loadGameData("data/larian");
  background = Object.keys(data.rules.backgrounds)[0] ?? "";
});

function level(cls: string, choices: Record<string, Choice> = {}): Level {
  return { class: cls, choices };
}

function character(levels: Level[], race = "Human", subrace: string | null = null): Character {
  const abilities = { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 };
  return { id: "c1", who: "player", race, subrace, background, abilities, levels, items: [], notes: "" };
}

function classRows(name: string, lvl: number, multiclass: boolean) {
  const table = data.rules.classes[name]?.table;
  return data.rules.progressions.filter((p) => p.table === table && p.level === lvl && p.multiclass === multiclass);
}

function tableRows(name: string, lvl: number) {
  const table = data.rules.classes[name]?.table ?? data.rules.races[name]?.table;
  return data.rules.progressions.filter((p) => p.table === table && p.level === lvl);
}

const RANGER_SUBCLASSES = ["BeastMaster", "GloomStalker", "Hunter", "Swarmkeeper"];

describe("resolve", () => {
  it("gives Ranger 1 its normal row with the ability bonus", () => {
    const { levels, issues } = resolve(character([level("Ranger")]), data);
    expect(issues).toEqual([]);
    const first = levels[0];
    expect(first).toMatchObject({ level: 1, class: "Ranger", classLevel: 1, subclassChoice: null, featChoice: false });
    const row = classRows("Ranger", 1, false)[0];
    expect(row).toBeDefined();
    expect(first?.rows.map((r) => r.uuid)).toContain(row?.uuid);
    expect(first?.rows.some((r) => r.multiclass)).toBe(false);
    expect(first?.slots.some((s) => s.selector.function === "SelectAbilityBonus")).toBe(true);
    const bonus = first?.slots.find((s) => s.selector.function === "SelectAbilityBonus");
    expect(bonus?.id).toBe(`${row?.uuid}/${row?.selectors.findIndex((s) => s.function === "SelectAbilityBonus")}`);
    expect(bonus?.level).toBe(1);
    expect(bonus?.progression).toBe(row?.uuid);
  });

  it("gives Rogue taken at level 2 its multiclass row, without ability bonus", () => {
    const { levels, issues } = resolve(character([level("Ranger"), level("Rogue")]), data);
    expect(issues).toEqual([]);
    const second = levels[1];
    expect(second).toMatchObject({ level: 2, class: "Rogue", classLevel: 1 });
    const multi = classRows("Rogue", 1, true)[0];
    const normal = classRows("Rogue", 1, false)[0];
    expect(second?.rows.filter((r) => r.type !== "race").map((r) => r.uuid)).toEqual([multi?.uuid]);
    expect(second?.rows.map((r) => r.uuid)).not.toContain(normal?.uuid);
    expect(second?.slots.some((s) => s.selector.function === "SelectAbilityBonus")).toBe(false);
  });

  it("offers the Ranger subclasses at Ranger level 3", () => {
    const { levels, issues } = resolve(character([level("Ranger"), level("Ranger"), level("Ranger")]), data);
    expect(levels[0]?.subclassChoice).toBeNull();
    expect(levels[1]?.subclassChoice).toBeNull();
    expect(levels[2]?.subclassChoice?.toSorted()).toEqual(RANGER_SUBCLASSES);
    expect(issues).toEqual([{ severity: "incomplete", code: "choiceMissing", character: "c1", level: 3, slot: "subclass:Ranger", params: { class: "Ranger" } }]);
  });

  it("applies the Gloom Stalker rows from Ranger level 3 on", () => {
    const levels6 = [level("Ranger"), level("Ranger"), level("Ranger", { "subclass:Ranger": ["GloomStalker"] }), level("Ranger"), level("Ranger")];
    const { levels, issues } = resolve(character(levels6), data);
    expect(issues).toEqual([]);
    const gs3 = tableRows("GloomStalker", 3).map((r) => r.uuid);
    const gs5 = tableRows("GloomStalker", 5).map((r) => r.uuid);
    expect(gs3).toHaveLength(1);
    expect(gs5).toHaveLength(1);
    const ranger3 = classRows("Ranger", 3, false).map((r) => r.uuid);
    expect(levels[2]?.rows.filter((r) => r.type !== "race").map((r) => r.uuid)).toEqual([...ranger3, ...gs3]);
    expect(levels[4]?.rows.map((r) => r.uuid)).toContain(gs5[0]);
    const gloomTable = data.rules.classes["GloomStalker"]?.table;
    expect(levels[0]?.rows.some((r) => r.table === gloomTable)).toBe(false);
    expect(levels[1]?.rows.some((r) => r.table === gloomTable)).toBe(false);
  });

  it("rejects a subclass that the level does not offer", () => {
    const levels3 = [level("Ranger"), level("Ranger"), level("Ranger", { "subclass:Ranger": ["BattleMaster"] })];
    const { levels, issues } = resolve(character(levels3), data);
    expect(issues).toEqual([{ severity: "invalid", code: "subclassNotOffered", character: "c1", level: 3, slot: "subclass:Ranger", params: { class: "Ranger", subclass: "BattleMaster" } }]);
    expect(levels[2]?.rows.every((r) => r.type === "class" || r.type === "race")).toBe(true);
  });

  it("flags an off-data subclass and applies no subclass rows", () => {
    const levels3 = [level("Ranger"), level("Ranger"), level("Ranger", { "subclass:Ranger": { offData: "Homebrew" } })];
    const { levels, issues } = resolve(character(levels3), data);
    expect(issues).toEqual([{ severity: "notice", code: "offData", character: "c1", level: 3, slot: "subclass:Ranger", params: { class: "Ranger" } }]);
    expect(levels[2]?.rows.some((r) => r.type === "subclass")).toBe(false);
  });

  it("gives a Lightfoot Halfling its race and subrace rows at level 1", () => {
    const { levels, issues } = resolve(character([level("Ranger"), level("Ranger")], "Halfling", "Halfling_Lightfoot"), data);
    expect(issues).toEqual([]);
    const race = tableRows("Halfling", 1).map((r) => r.uuid);
    const subrace = tableRows("Halfling_Lightfoot", 1).map((r) => r.uuid);
    expect(race).toHaveLength(1);
    expect(subrace).toHaveLength(1);
    const ranger = classRows("Ranger", 1, false).map((r) => r.uuid);
    expect(levels[0]?.rows.map((r) => r.uuid)).toEqual([...ranger, ...race, ...subrace]);
    expect(levels[1]?.rows.some((r) => r.type === "race")).toBe(false);
  });

  it("reports a missing subrace, an unknown one and a mismatched one", () => {
    expect(resolve(character([level("Ranger")], "Halfling", null), data).issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: null, slot: "subrace", params: {} },
    ]);
    expect(resolve(character([level("Ranger")], "Halfling", "Halfling_Nope"), data).issues).toEqual([
      { severity: "invalid", code: "unknownSubrace", character: "c1", level: null, slot: "subrace", params: { subrace: "Halfling_Nope" } },
    ]);
    const mismatch = resolve(character([level("Ranger")], "Elf", "Halfling_Lightfoot"), data);
    expect(mismatch.issues).toEqual([
      { severity: "invalid", code: "subraceMismatch", character: "c1", level: null, slot: "subrace", params: { race: "Elf", subrace: "Halfling_Lightfoot" } },
    ]);
    const lightfoot = data.rules.races["Halfling_Lightfoot"]?.table;
    expect(mismatch.levels[0]?.rows.some((r) => r.table === lightfoot)).toBe(false);
    expect(resolve(character([level("Ranger")], "Human", "Halfling_Lightfoot"), data).issues.map((i) => i.code)).toEqual(["subraceMismatch"]);
  });

  it("reports an unknown race, a subrace used as race and an unknown or missing background", () => {
    expect(resolve(character([level("Ranger")], "Halfling_Lightfoot", null), data).issues.map((i) => [i.code, i.params])).toEqual([["unknownRace", { race: "Halfling_Lightfoot" }]]);
    expect(resolve(character([level("Ranger")], "", null), data).issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: null, slot: "race", params: {} },
    ]);
    const noBackground = { ...character([level("Ranger")]), background: "" };
    expect(resolve(noBackground, data).issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: null, slot: "background", params: {} },
    ]);
    const badBackground = { ...character([level("Ranger")]), background: "__proto__" };
    expect(resolve(badBackground, data).issues).toEqual([
      { severity: "invalid", code: "unknownBackground", character: "c1", level: null, slot: "background", params: { background: "__proto__" } },
    ]);
  });

  it("reports an empty class as missing and an unknown class or subclass as invalid", () => {
    const { levels, issues } = resolve(character([level("Ranger"), level(""), level("Nope"), level("GloomStalker")]), data);
    expect(issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: 2, slot: "class", params: {} },
      { severity: "invalid", code: "unknownClass", character: "c1", level: 3, slot: "class", params: { class: "Nope" } },
      { severity: "invalid", code: "unknownClass", character: "c1", level: 4, slot: "class", params: { class: "GloomStalker" } },
    ]);
    expect(levels).toHaveLength(4);
    // The class contributes nothing; the race rows still apply at their character level.
    for (const unresolved of levels.slice(1)) expect(unresolved.rows.every((r) => r.type === "race")).toBe(true);
    const human = data.rules.races["Human"]?.table;
    expect(levels[1]?.rows.map((r) => r.uuid)).toEqual(data.rules.progressions.filter((p) => p.table === human && p.level === 2).map((p) => p.uuid));
  });

  it("flags the BattleMaster level 3 ambiguity and keeps both rows' slots", () => {
    const levels3 = [level("Fighter"), level("Fighter"), level("Fighter", { "subclass:Fighter": ["BattleMaster"] })];
    const { levels, issues } = resolve(character(levels3), data);
    const duplicates = tableRows("BattleMaster", 3).map((r) => r.uuid).toSorted();
    expect(duplicates).toHaveLength(2);
    expect(issues).toEqual([{ severity: "notice", code: "ambiguousGameData", character: "c1", level: 3, slot: null, params: { rows: duplicates.join(", ") } }]);
    const third = levels[2];
    expect(third?.rows.filter((r) => r.type === "subclass").map((r) => r.uuid).toSorted()).toEqual(duplicates);
    for (const uuid of duplicates) expect(third?.slots.some((s) => s.id === `${uuid}/0`)).toBe(true);
  });

  it("flags the Cleric multiclass ambiguity and offers the subclasses of both rows", () => {
    const { levels, issues } = resolve(character([level("Fighter"), level("Cleric")]), data);
    const duplicates = classRows("Cleric", 1, true).map((r) => r.uuid).toSorted();
    expect(duplicates).toHaveLength(2);
    expect(issues).toContainEqual({ severity: "notice", code: "ambiguousGameData", character: "c1", level: 2, slot: null, params: { rows: duplicates.join(", ") } });
    expect(levels[1]?.slots).toHaveLength(5);
    expect(levels[1]?.subclassChoice).toContain("WarDomain");
  });

  it("exposes the feat choice on feat levels", () => {
    const { levels } = resolve(character(Array.from({ length: 4 }, () => level("Rogue"))), data);
    expect(levels.map((l) => l.featChoice)).toEqual([false, false, false, true]);
  });

  it("rejects more than 12 levels and resolves only the first 12", () => {
    const thirteen = Array.from({ length: 13 }, () => level("Fighter", { "subclass:Fighter": ["Champion"] }));
    const { levels, issues } = resolve(character(thirteen), data);
    expect(issues).toContainEqual({ severity: "invalid", code: "tooManyLevels", character: "c1", level: null, slot: null, params: { count: 13, max: 12 } });
    expect(levels).toHaveLength(12);
  });
});
