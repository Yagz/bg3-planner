import { describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";

describe("game data", () => {
  it("loads the committed data", async () => {
    const data = await loadGameData("data/larian");
    const { rules } = data;

    const baseClasses = Object.values(rules.classes).filter((c) => c.parent === null);
    expect(baseClasses).toHaveLength(12);

    const ranger = rules.classes["Ranger"];
    expect(ranger).toBeDefined();
    const rows = rules.progressions.filter((p) => p.table === ranger?.table && p.level === 3);
    const subclassRow = rows.find((p) => p.subclasses.length > 0);
    expect(subclassRow?.subclasses.toSorted()).toEqual(["BeastMaster", "GloomStalker", "Hunter", "Swarmkeeper"]);

    const listKeys = new Set(Object.keys(rules.lists));
    const selectors = [
      ...rules.progressions.flatMap((p) => p.selectors),
      ...Object.values(rules.feats).flatMap((f) => f.selectors),
    ];
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(listKeys.has(selector.list), `${selector.function} list ${selector.list}`).toBe(true);
    }

    expect(Object.keys(data.texts.en).length).toBeGreaterThan(0);
    expect(Object.keys(data.texts.fr).length).toBeGreaterThan(0);
    for (const texts of [data.texts.en, data.texts.fr]) {
      for (const key of Object.keys(texts)) expect(key, key).toMatch(/^(ability|background|class|feat|item|label|origin|passive|race|ruleset|skill|spell):./);
    }
    expect(data.texts.en["class:Ranger"]?.name).toBeTruthy();
    expect(data.meta.game).toMatch(/^\d/);
  });

  it("loads the hand-written skill-to-ability map", async () => {
    const data = await loadGameData("data/larian");
    expect(data.skills.Athletics).toBe("Strength");
    expect(data.skills.SleightOfHand).toBe("Dexterity");
    expect(Object.keys(data.skills)).toHaveLength(18);
  });

  it("names every origin, skill and ability in both languages", async () => {
    const data = await loadGameData("data/larian");
    const shadowheart = data.rules.origins.Shadowheart;
    expect(shadowheart?.class).toBe("Cleric");
    expect(shadowheart?.race).toBe("HalfElf");
    expect(shadowheart?.subrace).toBe("HalfElf_High");
    const playable = Object.keys(data.rules.origins).filter((id) => data.rules.origins[id]!.playable);
    expect(playable.sort()).toEqual(["Astarion", "DarkUrge", "Gale", "Generic", "Karlach", "Laezel", "Shadowheart", "Wyll"]);
    expect(data.texts.fr["skill:Athletics"]?.name).toBe("Athlétisme");
    const keys = [
      ...Object.keys(data.rules.origins).map((id) => `origin:${id}`),
      ...Object.keys(data.skills).map((id) => `skill:${id}`),
      ...["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"].map((id) => `ability:${id}`),
    ];
    expect(Object.keys(data.rules.origins).length).toBeGreaterThan(0);
    for (const texts of [data.texts.en, data.texts.fr]) {
      for (const key of keys) expect(texts[key]?.name, key).toBeTruthy();
    }
  });
  it("loads the rulesets, their build values and the Custom Mode label", async () => {
    const data = await loadGameData("data/larian");
    expect(data.rules.rulesets.DIFFICULTY_EASY?.values).toEqual({ MULTICLASSING: false, PROFICIENCY_BONUS: 2 });
    // The produced JSON has sorted keys, so the file order of the game is not kept.
    expect(Object.keys(data.rules.rulesets).sort()).toEqual(
      ["DIFFICULTY_EASY", "DIFFICULTY_MEDIUM", "DIFFICULTY_HARD", "RULESET_LARIAN", "RULESET_HONOUR"].sort(),
    );
    expect(data.rules.rulesetModifiers.PROFICIENCY_BONUS).toEqual({ type: "int", default: 0, min: -1, max: 4, custom: true });
    expect(data.texts.fr["ruleset:DIFFICULTY_EASY"]?.name).toBe("Explorateur");
    expect(data.texts.fr["label:customMode"]?.name).toBe("Mode Personnalisé");
  });
});
