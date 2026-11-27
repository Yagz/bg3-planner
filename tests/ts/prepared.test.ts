// Prepared spells per level.
//
// Sources checked on 2026-11-26:
// - Cleric, bg3.wiki https://bg3.wiki/wiki/Cleric: "Cleric level + Wisdom modifier (Minimum of 1 spell.)"; Fextralife
//   https://baldursgate3.wiki.fextralife.com/Cleric: "Known Spells: Wisdom modifier + your Cleric level".
// - Druid, bg3.wiki https://bg3.wiki/wiki/Druid: "Number of Prepared Spells = Druid Level + Wisdom Modifier", level 1
//   "Choose a number of Spells = 1 (Druid Level) + Wisdom Modifier (Minimum of 1 spell)".
// - Wizard, bg3.wiki https://bg3.wiki/wiki/Wizard: level 1 "Choose a number of Spells = 1 (Wizard Level) + Intelligence
//   Modifier", "(Minimum of 1 spell.)".
// - Paladin: the sources disagree. bg3.wiki https://bg3.wiki/wiki/Paladin: "Number of Prepared Spells = Paladin Level +
//   Charisma Modifier (Minimum of 1 spell)", and per level, e.g. level 2 "Choose a number of Spells = 2 (Paladin Level) +
//   Charisma Modifier (Minimum of 1 spell.)". Fextralife https://baldursgate3.wiki.fextralife.com/Paladin: "Known Spells:
//   1 + your Charisma modifier + half your Paladin level (rounded down)." The spec had floor(level / 2) + modifier.
//   bg3.wiki's formula, backed by its per-level progression text, is used (maintainer ruling); an in-game check is pending.
// - Always-prepared spells (domain, oath, circle) do not count against the number (spec rule): both sources call them
//   "always prepared" but neither states in one sentence that they do not count.

import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { PREPARED_COUNT, preparedIssues, preparedState } from "../../src/engine/prepared.ts";
import { resolve } from "../../src/engine/progression.ts";
import { validate } from "../../src/engine/validate.ts";
import { emptyEquipment, emptyRun } from "../../src/plan/model.ts";
import type { Ability, Character, Choice, Level } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

const BASE: Record<Ability, number> = { Strength: 10, Dexterity: 14, Constitution: 14, Intelligence: 10, Wisdom: 12, Charisma: 10 };

function character(levels: Level[], abilities: Partial<Record<Ability, number>> = {}): Character {
  return {
    id: "c1",
    who: "player",
    race: "Human",
    subrace: null,
    background: "Acolyte",
    abilities: { ...BASE, ...abilities },
    levels,
    equipment: emptyEquipment(),
    notes: "",
  };
}

const LIFE: Record<string, Choice> = { "subclass:Cleric": ["LifeDomain"] };

/** Cleric 1 (Life Domain) at level 1, Bard at levels 2–7, Cleric 2 at level 8; `prepared` by character level. */
function clericBard(prepared: Record<number, string[]> = {}): Character {
  const levels: Level[] = [];
  for (let n = 1; n <= 8; n++) {
    const cls = n === 1 || n === 8 ? "Cleric" : "Bard";
    const level: Level = { class: cls, choices: n === 1 ? LIFE : {} };
    if (Object.hasOwn(prepared, n)) level.prepared = prepared[n];
    levels.push(level);
  }
  return character(levels);
}

const prepIssues = (c: Character) => preparedIssues(c, data).map(({ code, level, slot, params }) => ({ code, level, slot, params }));

describe("prepared spells", () => {
  it("Cleric 1 may prepare level-1 cleric spells; Bless and Cure Wounds of the Life Domain are always prepared and not in the pool", () => {
    const state = preparedState(clericBard(), data, 1);
    expect(state).not.toBeNull();
    expect(state!.cls).toBe("Cleric");
    expect(state!.classLevel).toBe(1);
    expect(state!.pool).toContain("Projectile_GuidingBolt");
    expect(state!.pool).toContain("Target_HealingWord");
    expect(state!.pool).not.toContain("Target_CureWounds");
    expect(state!.pool).not.toContain("Target_Bless");
    expect(state!.always).toEqual(expect.arrayContaining(["Target_CureWounds", "Target_Bless"]));
    for (const spell of [...state!.pool, ...state!.always]) expect(data.rules.spells[spell]?.level).toBe(1);
  });

  it("count is 2 at Cleric 1 and 3 at Cleric 2 with Wisdom +1", () => {
    const c = clericBard();
    expect(preparedState(c, data, 1)?.count).toBe(2);
    expect(preparedState(c, data, 8)?.count).toBe(3);
    expect(preparedState(c, data, 8)?.classLevel).toBe(2);
    expect(preparedState(c, data, 8)?.modifier).toBe(1);
    expect(preparedState(character([{ class: "Cleric", choices: LIFE }], { Wisdom: 8 }), data, 1)).toMatchObject({ count: 1, modifier: -1 });
  });

  it("level 8 inherits level 1's list; its own list replaces it", () => {
    const list = ["Projectile_GuidingBolt", "Target_HealingWord"];
    const inherited = preparedState(clericBard({ 1: list }), data, 8);
    expect(inherited).toMatchObject({ list, from: 1, own: false });
    const own = ["Projectile_GuidingBolt", "Target_HealingWord", "Target_ShieldOfFaith"];
    const replaced = clericBard({ 1: list, 8: own });
    expect(preparedState(replaced, data, 8)).toMatchObject({ list: own, from: 8, own: true });
    expect(preparedState(replaced, data, 1)).toMatchObject({ list, from: 1, own: true });
    expect(prepIssues(replaced)).toEqual([]);
    // Level 8 inherits two spells where three may be prepared.
    expect(prepIssues(clericBard({ 1: list }))).toEqual([{ code: "preparedMissing", level: 8, slot: "prepared", params: { count: 2, expected: 3 } }]);
  });

  it("a class with no list gives one preparedMissing, at its first level", () => {
    const c = clericBard();
    expect(preparedState(c, data, 1)).toMatchObject({ list: null, from: null, own: false });
    expect(prepIssues(c)).toEqual([{ code: "preparedMissing", level: 1, slot: "prepared", params: { count: 0, expected: 2 } }]);
    const report = validate({ ...emptyRun(), characters: [c] }, data);
    expect(report.issues.filter((i) => i.code === "preparedMissing")).toEqual([
      { severity: "incomplete", code: "preparedMissing", character: "c1", level: 1, slot: "prepared", params: { count: 0, expected: 2 } },
    ]);
  });

  it("a list over the count is invalid at every level where it applies", () => {
    const four = ["Projectile_GuidingBolt", "Target_HealingWord", "Target_ShieldOfFaith", "Target_Bane"];
    const c = clericBard({ 1: four });
    expect(prepIssues(c)).toEqual([
      { code: "preparedTooMany", level: 1, slot: "prepared", params: { count: 4, expected: 2 } },
      { code: "preparedTooMany", level: 8, slot: "prepared", params: { count: 4, expected: 3 } },
    ]);
    const report = validate({ ...emptyRun(), characters: [c] }, data);
    expect(report.status).toBe("invalid");
    expect(report.issues.filter((i) => i.code === "preparedTooMany").every((i) => i.severity === "invalid")).toBe(true);
  });

  it("an empty own list is a list: preparedMissing, not inherited", () => {
    const c = clericBard({ 1: ["Projectile_GuidingBolt", "Target_HealingWord"], 8: [] });
    expect(preparedState(c, data, 8)).toMatchObject({ list: [], from: 8, own: true });
    expect(prepIssues(c)).toEqual([{ code: "preparedMissing", level: 8, slot: "prepared", params: { count: 0, expected: 3 } }]);
  });

  it("prepared on a Bard level is preparedNotOffered", () => {
    const c = clericBard({ 1: ["Projectile_GuidingBolt", "Target_HealingWord"], 3: ["Target_Bane"] });
    expect(preparedState(c, data, 3)).toBeNull();
    const issues = preparedIssues(c, data).filter((i) => i.level === 3);
    expect(issues).toEqual([{ severity: "invalid", code: "preparedNotOffered", character: "c1", level: 3, slot: "prepared", params: { class: "Bard" } }]);
  });

  it("refuses a spell outside the pool, an always-prepared one and a duplicate", () => {
    const c = clericBard({ 1: ["Target_CureWounds", "Shout_Aid"], 8: ["Projectile_GuidingBolt", "Projectile_GuidingBolt", "Target_Bane"] });
    expect(prepIssues(c)).toEqual([
      { code: "notInList", level: 1, slot: "prepared", params: { item: "Target_CureWounds" } },
      { code: "notInList", level: 1, slot: "prepared", params: { item: "Shout_Aid" } },
      { code: "duplicateChoice", level: 8, slot: "prepared", params: { item: "Projectile_GuidingBolt" } },
    ]);
  });

  it("a Wizard prepares among its spellbook picks only", () => {
    const probe = character([{ class: "Wizard", choices: {} }]);
    const book = resolve(probe, data).levels[0]!.slots.find((s) => s.selector.function === "SelectSpells" && s.selector.prepare === null);
    expect(book).toBeDefined();
    const picks = ["Zone_BurningHands", "Target_CharmPerson", "Projectile_ChromaticOrb", "Zone_ColorSpray", "Shout_DisguiseSelf", "Shout_ExpeditiousRetreat"];
    const wizard = character([{ class: "Wizard", choices: { [book!.id]: picks }, prepared: ["Zone_BurningHands", "Projectile_MagicMissile"] }], { Intelligence: 12 });
    const state = preparedState(wizard, data, 1);
    expect(state?.pool.slice().sort()).toEqual(picks.slice().sort());
    expect(state?.count).toBe(2);
    expect(prepIssues(wizard)).toEqual([{ code: "notInList", level: 1, slot: "prepared", params: { item: "Projectile_MagicMissile" } }]);
  });

  it("Paladin 2 with Charisma 16 prepares 5", () => {
    const paladin = character([{ class: "Paladin", choices: {} }, { class: "Paladin", choices: {} }], { Charisma: 16 });
    // Paladin 1 has nothing to prepare: no preparedMissing until level 2.
    expect(preparedState(paladin, data, 1)?.pool).toEqual([]);
    expect(prepIssues(paladin)).toEqual([{ code: "preparedMissing", level: 2, slot: "prepared", params: { count: 0, expected: 5 } }]);
    const state = preparedState(paladin, data, 2);
    expect(state?.count).toBe(5);
    expect(state?.pool).toContain("Target_Bless");
    expect(state?.always).toContain("Target_Smite_Divine");
  });

  it("every class with prepares_spells has a PREPARED_COUNT entry", () => {
    const preparing = Object.entries(data.rules.classes).filter(([, def]) => def.parent === null && def.prepares_spells).map(([name]) => name);
    expect(preparing.sort()).toEqual(Object.keys(PREPARED_COUNT).sort());
  });
});
