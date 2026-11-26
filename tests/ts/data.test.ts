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
      for (const key of Object.keys(texts)) expect(key, key).toMatch(/^(ability|background|class|feat|item|label|modifier|origin|passive|race|ruleset|skill|slot|damage|spell):./);
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
    // The produced JSON sorts its keys: the game's order is the `order` field.
    const ids = Object.keys(data.rules.rulesets).sort((a, b) => data.rules.rulesets[a]!.order - data.rules.rulesets[b]!.order);
    expect(ids).toEqual(["DIFFICULTY_EASY", "DIFFICULTY_MEDIUM", "DIFFICULTY_HARD", "RULESET_LARIAN", "RULESET_HONOUR"]);
    expect(data.rules.rulesetModifiers.PROFICIENCY_BONUS).toEqual({ type: "int", default: 0, min: -1, max: 4, custom: true });
    expect(data.texts.fr["ruleset:DIFFICULTY_EASY"]?.name).toBe("Explorateur");
    expect(data.texts.fr["label:customMode"]?.name).toBe("Mode Personnalisé");
  });
  it("loads every item the equipment lists offer, with its game name, and every weapon's properties", async () => {
    const data = await loadGameData("data/larian");
    const names = { Drum: "Tambour à main", Flute: "Flûte", Lute: "Luth", Lyre: "Lyre", Violin: "Violon" };
    for (const [id, name] of Object.entries(names)) expect(data.texts.fr[`item:ARM_Instrument_${id}`]?.name).toBe(name);
    expect(data.texts.en["item:ARM_Instrument_Flute"]?.name).toBe("Flute");
    const offered = Object.values(data.rules.lists).filter((l) => l.type === "equipment").flatMap((l) => l.items);
    expect(offered.length).toBeGreaterThan(0);
    for (const id of offered) expect(data.rules.items[id], id).toBeDefined();
    expect(data.rules.items.WPN_Dagger?.properties).toContain("Light");
    expect(data.rules.items.ARM_Instrument_Flute?.found_by).toBe("list");
    for (const [id, item] of Object.entries(data.rules.items)) {
      if (item.stats_type === "Weapon") expect(item.properties.length, id).toBeGreaterThan(0);
    }
  });
  it("loads the skill descriptions, equipment slot names and damage type names of the interface files", async () => {
    const data = await loadGameData("data/larian");
    expect(data.texts.fr["skill:Persuasion"]?.description).toBe("Usez de vos charmes pour manipuler et amadouer vos interlocuteurs.");
    expect(data.texts.en["slot:Breast"]?.name).toBe("Body Attire");
    expect(data.texts.fr["slot:Underwear"]?.name).toBe("Ceinture");
    expect(data.texts.fr["damage:Fire"]?.name).toBe("Feu");
    const slots = ["Helmet", "Cloak", "Breast", "Gloves", "Boots", "Amulet", "Ring", "Ring2", "MeleeMainHand", "MeleeOffHand", "RangedMainHand", "RangedOffHand", "MusicalInstrument", "VanityBody", "VanityBoots", "Underwear"];
    const damageTypes = ["Slashing", "Piercing", "Bludgeoning", "Acid", "Thunder", "Necrotic", "Fire", "Lightning", "Cold", "Psychic", "Poison", "Radiant", "Force"];
    for (const texts of [data.texts.en, data.texts.fr]) {
      expect(Object.keys(texts).filter((k) => k.startsWith("slot:")).sort()).toEqual(slots.map((id) => `slot:${id}`).sort());
      expect(Object.keys(texts).filter((k) => k.startsWith("damage:")).sort()).toEqual(damageTypes.map((id) => `damage:${id}`).sort());
    }
  });
});
