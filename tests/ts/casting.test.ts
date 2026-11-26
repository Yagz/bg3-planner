import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { castingAbilities, castingAbility, spellSources } from "../../src/engine/casting.ts";
import { resolve } from "../../src/engine/progression.ts";
import { levelSlots } from "../../src/engine/validate.ts";
import type { Ability, Character, Choice } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

const SCORES: Record<Ability, number> = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };

function character(classes: string[], choices: Record<string, Choice>[], race = "Human", subrace: string | null = null): Character {
  return {
    id: "c1", who: "player", race, subrace, background: "", abilities: { ...SCORES },
    levels: classes.map((cls, i) => ({ class: cls, choices: choices[i] ?? {} })),
    equipment: { "1": {}, "2": {}, "3": {} }, notes: "",
  };
}

/** The casting ability of every slot of a level, by slot id, `null` included. */
function abilitiesAt(c: Character, lvl: number): Record<string, Ability | null> {
  const level = resolve(c, data).levels[lvl - 1];
  if (level === undefined) throw new Error("no such level");
  const slots = levelSlots(level, c.levels[lvl - 1]?.choices ?? {}, data);
  return Object.fromEntries(slots.selectors.map((slot) => [slot.id, castingAbility(level, slot, data)]));
}

const spellSlots = (c: Character, lvl: number) => {
  const level = resolve(c, data).levels[lvl - 1];
  return level?.slots.filter((s) => s.selector.function === "SelectSpells").map((s) => s.id) ?? [];
};

describe("castingAbility", () => {
  it("takes a race selector's own ability", () => {
    const c = character(["Fighter"], [{}], "Elf", "Elf_HighElf");
    expect(abilitiesAt(c, 1)["db13a1fb-7d64-4309-a1c8-e2a5c752ded5/0"]).toBe("Intelligence");
  });

  it("takes the class ability for a class row", () => {
    for (const [cls, ability] of [["Bard", "Charisma"], ["Cleric", "Wisdom"]] as const) {
      const c = character([cls], [{}]);
      const ids = spellSlots(c, 1);
      expect(ids.length).toBeGreaterThan(0);
      const found = abilitiesAt(c, 1);
      for (const id of ids) expect(found[id]).toBe(ability);
    }
  });

  it("takes the subclass ability for a subclass row", () => {
    const c = character(["Fighter", "Fighter", "Fighter"], [{}, {}, { "subclass:Fighter": ["EldritchKnight"] }]);
    const ids = spellSlots(c, 3);
    expect(ids.length).toBeGreaterThan(0);
    const found = abilitiesAt(c, 3);
    for (const id of ids) expect(found[id]).toBe("Intelligence");
  });

  it("gives null to a slot that picks no spells", () => {
    const c = character(["Bard"], [{}]);
    const skill = resolve(c, data).levels[0]?.slots.find((s) => s.selector.function === "SelectSkills");
    expect(skill).toBeDefined();
    expect(abilitiesAt(c, 1)[skill?.id ?? ""]).toBeNull();
  });

  it("gives null to a spell slot of a class without spellcasting ability and to an unknown row", () => {
    const c = character(["Bard"], [{}]);
    const level = resolve(c, data).levels[0];
    const slot = levelSlots(level!, {}, data).selectors.find((s) => s.selector.function === "SelectSpells")!;
    expect(castingAbility(level!, { ...slot, id: "nowhere/0" }, data)).toBeNull();
    expect(castingAbility(level!, { ...slot, selector: { ...slot.selector, ability: null } as typeof slot.selector }, { ...data, rules: { ...data.rules, classes: {} } })).toBeNull();
  });

  it("lists the abilities per level, omitting levels without spell slots", () => {
    const c = character(["Bard", "Bard"], [{}, {}], "Elf", "Elf_HighElf");
    const found = castingAbilities(c, data);
    expect(found).toHaveLength(2);
    expect(found[0]?.["db13a1fb-7d64-4309-a1c8-e2a5c752ded5/0"]).toBe("Intelligence");
    expect(Object.values(found[0] ?? {})).toContain("Charisma");
    expect(Object.values(found[1] ?? {}).every((a) => a === "Charisma")).toBe(true);
  });
});

describe("spellSources", () => {
  it("lists the classes then the race of a High Elf Cleric 1 / Bard", () => {
    const c = character(["Cleric", "Bard"], [{}, {}], "Elf", "Elf_HighElf");
    expect(spellSources(c, data, 2)).toEqual([
      { kind: "class", id: "Cleric", ability: "Wisdom" },
      { kind: "class", id: "Bard", ability: "Charisma" },
      { kind: "race", id: "Elf_HighElf", ability: "Intelligence" },
    ]);
    expect(spellSources(c, data, 1)).toEqual([
      { kind: "class", id: "Cleric", ability: "Wisdom" },
      { kind: "race", id: "Elf_HighElf", ability: "Intelligence" },
    ]);
  });

  it("gives a Fighter without subclass no class entry", () => {
    expect(spellSources(character(["Fighter", "Fighter", "Fighter"], [{}, {}, {}]), data, 3)).toEqual([]);
  });

  it("gives a Ranger an entry once it holds a spell selector", () => {
    const c = character(["Ranger", "Ranger"], [{}, {}]);
    expect(spellSources(c, data, 1)).toEqual([]);
    expect(spellSources(c, data, 2)).toEqual([{ kind: "class", id: "Ranger", ability: "Wisdom" }]);
  });

  it("counts a class only once its rows give a spell with a level: Paladin from level 2, never a Monk 2 (ki actions)", () => {
    const paladin = character(["Paladin", "Paladin"], [{}, {}]);
    expect(spellSources(paladin, data, 1)).toEqual([]);
    expect(spellSources(paladin, data, 2)).toEqual([{ kind: "class", id: "Paladin", ability: "Charisma" }]);
    expect(spellSources(character(["Monk", "Monk"], [{}, {}]), data, 2)).toEqual([]);
  });

  it("takes the ability of a spellcasting subclass", () => {
    const c = character(["Fighter", "Fighter", "Fighter"], [{}, {}, { "subclass:Fighter": ["EldritchKnight"] }]);
    const expected = data.rules.classes.EldritchKnight?.spellcasting_ability;
    expect(expected).toBeTruthy();
    expect(spellSources(c, data, 3)).toEqual([{ kind: "class", id: "Fighter", ability: expected }]);
  });

  it("skips a race whose spells have no ability and takes one with an ability", () => {
    expect(spellSources(character(["Fighter", "Fighter", "Fighter", "Fighter", "Fighter"], [], "Dwarf", "Duergar"), data, 5)).toEqual([]);
    expect(spellSources(character(["Fighter"], [{}], "Drow", "Drow_Seldarine"), data, 1)).toEqual([{ kind: "race", id: "Drow", ability: "Charisma" }]);
  });
});
