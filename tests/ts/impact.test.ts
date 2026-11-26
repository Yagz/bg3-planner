import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { impact, openSlotIds, pruneRemovedSlots } from "../../src/engine/impact.ts";
import { ISSUE_CODES } from "../../src/engine/issues.ts";
import { resolve } from "../../src/engine/progression.ts";
import { validate } from "../../src/engine/validate.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Ability, Character, Choice, Run } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

function runOf(...characters: Character[]): Run {
  const run = emptyRun("r1");
  run.characters = characters;
  run.party["1"].active = characters.map((c) => c.id);
  return run;
}

/** Gale's identity and preset scores, Wizard at every level, with the given subclass at level 2 and no choice made. */
function gale(levels: number, school: string): Character {
  const origin = data.rules.origins["Gale"]!;
  const choices = Array.from({ length: levels }, (_, i): Record<string, Choice> => (i === 1 ? { "subclass:Wizard": [school] } : {}));
  return {
    id: "gale",
    who: "Gale",
    race: origin.race ?? "",
    subrace: origin.subrace,
    background: origin.background ?? "",
    abilities: { ...origin.abilities! },
    levels: choices.map((c) => ({ class: "Wizard", choices: c })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
}

/** Fills every open selector slot with real, distinct picks from its list (the first unused items). */
function fill(c: Character): Character {
  const used = new Set<string>();
  for (const level of resolve(c, data).levels) {
    const choices = c.levels[level.level - 1]!.choices;
    for (const slot of level.slots) {
      const s = slot.selector;
      if (s.function === "AddSpells" || s.function === "ReplacePassives") continue;
      const items = data.rules.lists[s.list]?.items ?? [];
      if (s.function === "SelectAbilityBonus") {
        choices[slot.id] = items.slice(0, s.bonuses.length);
        continue;
      }
      if (s.function === "SelectAbilities") {
        choices[slot.id] = Array.from({ length: s.count }, () => "Intelligence");
        continue;
      }
      const picks = items.filter((item) => !used.has(item)).slice(0, s.count);
      for (const pick of picks) used.add(pick);
      choices[slot.id] = picks;
    }
  }
  return c;
}

function withSchool(c: Character, school: string): Character {
  const copy = structuredClone(c);
  copy.levels[1]!.choices["subclass:Wizard"] = [school];
  return copy;
}

function rowOf(subclass: string, level: number) {
  const table = data.rules.classes[subclass]!.table;
  return data.rules.progressions.find((p) => p.table === table && p.level === level)!;
}

describe("openSlotIds", () => {
  it("lists the subclass, selector and feat slots per level, as validate accepts them", () => {
    const c = fill(gale(4, "EvocationSchool"));
    c.levels[3]!.choices["feat:4"] = ["AbilityScoreIncrease"];
    c.levels[3]!.choices["feat:4/0"] = ["Intelligence", "Constitution"];
    const open = openSlotIds(c, data);
    expect(open.get(2)?.has("subclass:Wizard")).toBe(true);
    expect(open.get(2)?.has(`${rowOf("EvocationSchool", 2).uuid}/0`)).toBe(true);
    expect([...(open.get(4) ?? [])].filter((id) => id.startsWith("feat:"))).toEqual(["feat:4", "feat:4/0"]);
    // Every key of the character's choices is open, and validate reports no unknown slot.
    for (const [i, level] of c.levels.entries()) for (const key of Object.keys(level.choices)) expect(open.get(i + 1)?.has(key)).toBe(true);
    expect(validate(runOf(c), data).issues.filter((i) => i.code === "unknownSlot")).toEqual([]);
  });

  it("leaves out levels whose class is unresolved, where validate checks no key", () => {
    const c = gale(2, "EvocationSchool");
    c.levels[1]!.class = { offData: "ModdedClass" };
    c.levels[1]!.choices = { "modded/0": ["Anything"] };
    expect(openSlotIds(c, data).has(2)).toBe(false);
    expect(pruneRemovedSlots(c, data).character.levels[1]!.choices).toEqual({ "modded/0": ["Anything"] });
  });
});

describe("pruneRemovedSlots", () => {
  it("removes only the picks of slots a subclass swap closes, exactly those validate reports as unknown", () => {
    const before = fill(gale(4, "EvocationSchool"));
    before.levels[3]!.choices["feat:4"] = ["AbilityScoreIncrease"];
    before.levels[3]!.choices["feat:4/0"] = ["Intelligence", "Constitution"];
    expect(validate(runOf(before), data).issues.filter((i) => i.severity === "invalid")).toEqual([]);
    const after = withSchool(before, "NecromancySchool");
    const snapshot = structuredClone(after);

    const { character, removed } = pruneRemovedSlots(after, data);

    const evocationKeys = [2, 3, 4].flatMap((n) => Object.keys(before.levels[n - 1]!.choices).filter((k) => k.startsWith(rowOf("EvocationSchool", n).uuid)).map((slot) => ({ level: n, slot })));
    expect(evocationKeys.length).toBeGreaterThan(0);
    expect(removed.map(({ level, slot }) => ({ level, slot }))).toEqual(evocationKeys);
    for (const r of removed) expect(r.choice).toEqual(before.levels[r.level - 1]!.choices[r.slot]);
    const unknown = validate(runOf(after), data).issues.filter((i) => i.code === "unknownSlot").map((i) => ({ level: i.level, slot: i.slot }));
    expect(removed.map(({ level, slot }) => ({ level, slot }))).toEqual(unknown);
    expect(validate(runOf(character), data).issues.filter((i) => i.code === "unknownSlot")).toEqual([]);
    // Everything else is kept as it was, and the input is untouched.
    expect(character.levels[0]).toEqual(before.levels[0]);
    expect(character.levels[1]!.choices["subclass:Wizard"]).toEqual(["NecromancySchool"]);
    expect(character.levels[3]!.choices["feat:4"]).toEqual(["AbilityScoreIncrease"]);
    expect(character.levels[3]!.choices["feat:4/0"]).toEqual(["Intelligence", "Constitution"]);
    expect(after).toEqual(snapshot);
  });
});

describe("impact", () => {
  it("previews a school swap: features lost and gained, slots added and removed, nothing newly invalid", () => {
    const before = fill(gale(4, "EvocationSchool"));
    const after = withSchool(before, "NecromancySchool");
    const result = impact(before, after, runOf(before), data);

    const evocation = rowOf("EvocationSchool", 2).passives_added;
    const necromancy = rowOf("NecromancySchool", 2).passives_added;
    expect(evocation.length).toBeGreaterThan(0);
    expect(necromancy.length).toBeGreaterThan(0);
    for (const id of evocation) expect(result.lost).toContainEqual({ kind: "passive", id, level: 2 });
    for (const id of necromancy) expect(result.gained).toContainEqual({ kind: "passive", id, level: 2 });
    expect(result.lost.some((f) => necromancy.includes(f.id))).toBe(false);
    expect(result.lost.some((f) => f.id === "UnlockedSpellSlotLevel1")).toBe(false);

    const necroSlots = [2, 3, 4].flatMap((n) => rowOf("NecromancySchool", n).selectors.map((_, i) => ({ level: n, slot: `${rowOf("NecromancySchool", n).uuid}/${i}` })));
    expect(result.slotsAdded).toEqual(necroSlots);
    expect(result.slotsRemoved).toEqual(pruneRemovedSlots(after, data).removed);
    expect(result.result).toEqual(pruneRemovedSlots(after, data).character);
    expect(result.newlyInvalid).toEqual([]);
    expect(result.coverage).toEqual({ gained: [], lost: [] });
  });

  it("reports the picks of a dropped level as removed picks", () => {
    const before = fill(gale(4, "EvocationSchool"));
    const after = { ...before, levels: before.levels.slice(0, 3) };
    const result = impact(before, after, runOf(before), data);
    const dropped = Object.entries(before.levels[3]!.choices).map(([slot, choice]) => ({ level: 4, slot, choice }));
    expect(dropped.length).toBeGreaterThan(0);
    expect(result.slotsRemoved).toEqual(dropped);
    expect(result.result).toEqual(after);
  });

  it("flags a feat whose requirement fails after an ability-bonus change, and keeps it", () => {
    const scores: Record<Ability, number> = { Strength: 15, Dexterity: 12, Constitution: 15, Intelligence: 8, Wisdom: 13, Charisma: 8 };
    const ranger = (bonus: string[]): Character => {
      const c: Character = { id: "r", who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: Object.keys(data.rules.backgrounds)[0] ?? "", abilities: { ...scores }, levels: ["Ranger", "Ranger", "Ranger", "Ranger"].map((cls) => ({ class: cls, choices: {} })), equipment: { "1": {}, "2": {}, "3": {} }, notes: "" };
      const bonusSlot = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!.id;
      c.levels[0]!.choices[bonusSlot] = bonus;
      c.levels[3]!.choices["feat:4"] = ["DefensiveDuelist"];
      return c;
    };
    const before = ranger(["Dexterity", "Wisdom"]);
    const after = ranger(["Strength", "Wisdom"]);
    const result = impact(before, after, runOf(before), data);
    expect(result.newlyInvalid.map((i) => [i.code, i.level, i.slot])).toEqual([["requirementNotMet", 4, "feat:4"]]);
    expect(result.result.levels[3]!.choices["feat:4"]).toEqual(["DefensiveDuelist"]);
    expect(result.slotsRemoved).toEqual([]);
  });

  it("reports the skills the active party gains and loses, and none for a character outside it", () => {
    const ranger = (skills: string[]): Character => {
      const c: Character = { id: "r", who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_HauntedOne"))!, abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 }, levels: [{ class: "Ranger", choices: {} }], equipment: { "1": {}, "2": {}, "3": {} }, notes: "" };
      const skillSlot = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectSkills")!.id;
      c.levels[0]!.choices[skillSlot] = skills;
      return c;
    };
    const before = ranger(["Stealth", "Perception", "Survival"]);
    const after = ranger(["Stealth", "Perception", "Nature"]);
    expect(impact(before, after, runOf(before), data).coverage).toEqual({ gained: ["Nature"], lost: ["Survival"] });
    const bench = runOf(before);
    bench.party["1"].active = [];
    expect(impact(before, after, bench, data).coverage).toEqual({ gained: [], lost: [] });
  });
});

describe("ISSUE_CODES", () => {
  it("lists exactly the issue codes the engine emits", () => {
    const dir = "src/engine";
    const source = readdirSync(dir).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(dir, f), "utf-8")).join("\n");
    const patterns = [/code: "(\w+)"/g, /issue\("(?:incomplete|invalid|notice)", "(\w+)"/g, /invalid\("(\w+)"/g, /notice\("(\w+)"/g];
    const found = new Set(patterns.flatMap((p) => [...source.matchAll(p)].map((m) => m[1] ?? "")));
    expect([...found].filter((code) => !(ISSUE_CODES as readonly string[]).includes(code))).toEqual([]);
    expect(ISSUE_CODES.filter((code) => !found.has(code))).toEqual([]);
    expect(found.size).toBeGreaterThanOrEqual(20);
  });
});
