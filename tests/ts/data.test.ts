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
      for (const key of Object.keys(texts)) expect(key, key).toMatch(/^(ability|background|class|feat|item|origin|passive|race|skill|spell):./);
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
});
