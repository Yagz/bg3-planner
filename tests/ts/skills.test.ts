import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { grantedSkills, skillBoosts } from "../../src/engine/skills.ts";
import type { Character } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

const GUILD_ARTISAN = "e9aeac40-6c4e-4d81-9a24-e9eeb6208e85";

function elf(subrace: string, levels = 1): Character {
  return {
    id: "c1",
    who: "player",
    race: "Elf",
    subrace,
    background: GUILD_ARTISAN,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: Array.from({ length: levels }, () => ({ class: "Cleric", choices: {} })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
}

describe("skillBoosts", () => {
  it("reads skill proficiencies and expertise, nothing else", () => {
    expect(skillBoosts(["ProficiencyBonus(Skill,Perception)", "ProficiencyBonus(Skill, Stealth)", "ExpertiseBonus(Arcana)", "Proficiency(Shields)"])).toEqual({
      proficient: ["Perception", "Stealth"],
      expertise: ["Arcana"],
    });
  });

  it("ignores conditional and advantage boosts that only mention a skill", () => {
    expect(skillBoosts(["Advantage(Skill,Stealth)", "IF(not HasProficiencyBonus(context.CheckedAbility,context.CheckedSkill,context.Source)):RollBonus(SkillCheck,ProficiencyBonus/2)"])).toEqual({
      proficient: [],
      expertise: [],
    });
  });
});

describe("grantedSkills", () => {
  it("names the race and the background for a High Elf Guild Artisan", () => {
    expect(grantedSkills(elf("Elf_HighElf"), data, 1)).toEqual(new Map([["Perception", "race"], ["Insight", "background"], ["Persuasion", "background"]]));
  });

  it("adds the subrace's skill for a Wood Elf", () => {
    expect(grantedSkills(elf("Elf_WoodElf"), data, 1)).toEqual(
      new Map([["Perception", "race"], ["Stealth", "subrace"], ["Insight", "background"], ["Persuasion", "background"]]),
    );
  });

  it("reads race passives as well as row boosts (Rock Gnome)", () => {
    const gnome = { ...elf("Gnome_Rock"), race: "Gnome", background: "" };
    expect(grantedSkills(gnome, data, 1)).toEqual(new Map([["History", "subrace"]]));
  });

  it("grants nothing for an off-data race, an undecided background or a subrace of another race", () => {
    expect(grantedSkills({ ...elf("Elf_HighElf"), race: { offData: "Mod race" }, background: "" }, data, 1)).toEqual(new Map());
    expect(grantedSkills({ ...elf("Elf_HighElf"), race: "", background: { offData: "Mod background" } }, data, 1)).toEqual(new Map());
    expect(grantedSkills({ ...elf("Elf_WoodElf"), race: "Human", background: "" }, data, 1)).toEqual(new Map());
  });
});
