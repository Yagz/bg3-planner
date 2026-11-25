import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { grantedFeatures } from "../../src/engine/features.ts";
import { resolve } from "../../src/engine/progression.ts";
import type { Character } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

function character(classes: string[], choices: Character["levels"][number]["choices"][] = []): Character {
  const background = Object.keys(data.rules.backgrounds)[0] ?? "";
  return {
    id: "c1",
    who: "player",
    race: "Halfling",
    subrace: "Halfling_Lightfoot",
    background,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: classes.map((cls, i) => ({ class: cls, choices: choices[i] ?? {} })),
    items: [],
    notes: "",
  };
}

describe("grantedFeatures", () => {
  it("lists the passives and granted spells of a Gloom Stalker's level 3, without technical passives", () => {
    const c = character(["Ranger", "Ranger", "Ranger"], [{}, {}, { "subclass:Ranger": ["GloomStalker"] }]);
    const level = resolve(c, data).levels[2]!;
    const features = grantedFeatures(level, data);
    const gloomRow = level.rows.find((r) => r.table === data.rules.classes["GloomStalker"]?.table)!;
    const grantList = gloomRow.selectors.find((s) => s.function === "AddSpells")!.list;
    const grantedSpells = data.rules.lists[grantList]!.items;

    expect(features).toContainEqual({ kind: "passive", id: "DreadAmbusher", level: 3 });
    for (const spell of grantedSpells) expect(features).toContainEqual({ kind: "spell", id: spell, level: 3 });
    expect(features.filter((f) => f.kind === "passive" && data.rules.passives[f.id]?.technical === true)).toEqual([]);
    expect(features.some((f) => f.id === "UnlockedSpellSlotLevel2")).toBe(false);
  });

  it("drops technical passives that a row adds", () => {
    const level = resolve(character(["Wizard"]), data).levels[0]!;
    expect(level.rows.some((r) => r.passives_added.includes("UnlockedSpellSlotLevel1"))).toBe(true);
    expect(data.rules.passives["UnlockedSpellSlotLevel1"]?.technical).toBe(true);
    expect(grantedFeatures(level, data).some((f) => f.id === "UnlockedSpellSlotLevel1")).toBe(false);
  });

  it("gives each feature once, in a stable order", () => {
    const level = resolve(character(["Wizard"]), data).levels[0]!;
    const features = grantedFeatures(level, data);
    const keys = features.map((f) => `${f.kind}:${f.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(grantedFeatures(level, data)).toEqual(features);
    // Halfling rows' passives come with the class level 1.
    expect(features).toContainEqual({ kind: "passive", id: "Halfling_Lucky", level: 1 });
  });
});
