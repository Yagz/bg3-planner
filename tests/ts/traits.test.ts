import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { backgroundTraits, identityTraits } from "../../src/engine/traits.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

describe("identityTraits", () => {
  it("lists the Elf passives, skill and base speed", () => {
    const traits = identityTraits(data, "Elf");
    expect(traits.filter((t) => t.kind === "passive").map((t) => (t as { id: string }).id)).toEqual(["Elf_WeaponTraining", "Darkvision", "FeyAncestry"]);
    expect(traits).toContainEqual({ level: 1, kind: "skill", skill: "Perception" });
    expect(traits).toContainEqual({ level: 1, kind: "speed", meters: 9, added: false });
  });

  it("marks a subrace's speed as added", () => {
    const traits = identityTraits(data, "Elf_WoodElf");
    expect(traits).toContainEqual({ level: 1, kind: "speed", meters: 1.5, added: true });
    expect(traits).toContainEqual({ level: 1, kind: "skill", skill: "Stealth" });
  });

  it("reports the Gold Dwarf's hit points per level", () => {
    expect(identityTraits(data, "Dwarf_GoldHill")).toContainEqual({ level: 1, kind: "hpPerLevel" });
  });

  it("lists the Duergar spells at levels 3 and 5 with no ability", () => {
    const spells = identityTraits(data, "Duergar").filter((t) => t.kind === "spells");
    expect(spells.map((t) => t.level)).toEqual([3, 5]);
    expect(spells.map((t) => (t as { spells: string[] }).spells)).toEqual([["Shout_Enlarge_Duergar"], ["Shout_Invisibility_Duergar"]]);
    expect(spells.every((t) => (t as { ability: unknown }).ability === null)).toBe(true);
  });

  it("offers the Human one skill", () => {
    expect(identityTraits(data, "Human")).toContainEqual({ level: 1, kind: "choice", function: "SelectSkills", count: 1, ability: null });
  });

  it("offers the High Elf a spell choice cast with Intelligence", () => {
    expect(identityTraits(data, "Elf_HighElf")).toContainEqual({ level: 1, kind: "choice", function: "SelectSpells", count: 1, ability: "Intelligence" });
  });

  it("leaves technical passives out", () => {
    const technical = new Set(Object.entries(data.rules.passives).filter(([, p]) => p.technical === true).map(([id]) => id));
    for (const race of Object.keys(data.rules.races)) {
      for (const t of identityTraits(data, race)) if (t.kind === "passive") expect(technical.has(t.id)).toBe(false);
    }
  });

  it("recognises every boost of every race and subrace", () => {
    for (const race of Object.keys(data.rules.races)) {
      expect(identityTraits(data, race).filter((t) => t.kind === "unknownBoost"), race).toEqual([]);
    }
  });

  it("reports a racial spell's charge counter as a resource", () => {
    expect(identityTraits(data, "Tiefling_Asmodeus")).toContainEqual({ level: 3, kind: "resource", resource: "Interrupt_HellishRebukeTiefling_Charge", amount: 1 });
  });

  it("is empty for an unknown race", () => {
    expect(identityTraits(data, "NoSuchRace")).toEqual([]);
  });
});

describe("backgroundTraits", () => {
  it("lists the skills of the guild artisan", () => {
    const uuid = Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_GuildArtisan"));
    expect(uuid).toBeDefined();
    const traits = backgroundTraits(data, uuid!);
    expect(traits.map((t) => (t.kind === "skill" ? t.skill : null)).sort()).toEqual(["Insight", "Persuasion"]);
    expect(traits.every((t) => t.level === 1)).toBe(true);
  });

  it("is empty for an unknown background", () => {
    expect(backgroundTraits(data, "nope")).toEqual([]);
  });
});
