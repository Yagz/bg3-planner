import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { effectiveEquipment, eligibleSlots, equipmentIssues, itemFirstAct, itemRarity, itemsForSlot } from "../../src/engine/equipment.ts";
import { resolve } from "../../src/engine/progression.ts";
import { validate } from "../../src/engine/validate.ts";
import { DATA_SLOT_TARGETS } from "../../src/plan/equipmentSlots.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Character, Choice, Equipment } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

function character(id: string, who: string, classes: string[] = ["Fighter"], choices: Record<string, Choice>[] = []): Character {
  return {
    id,
    who,
    race: "Human",
    subrace: null,
    background: "",
    abilities: { Strength: 15, Dexterity: 15, Constitution: 15, Intelligence: 8, Wisdom: 8, Charisma: 8 },
    levels: classes.map((cls, i) => ({ class: cls, choices: choices[i] ?? {} })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
}

function equipped(c: Character, equipment: Partial<Equipment>): Character {
  return { ...c, equipment: { "1": {}, "2": {}, "3": {}, ...equipment } };
}

const runOf = (...characters: Character[]) => ({ ...emptyRun(), characters });

const LIGHT_RANGED = [
  "MAG_Fire_IncreasePiercingDamageToBurning_HandCrossbow",
  "MAG_Generic_02_HandCrossbow_2",
  "MAG_MagicMissile_HandCrossbow",
  "MAG_Orthon_Hellfire_HandCrossbow",
  "WPN_HUM_HandCrossbow_A_0",
  "WPN_HUM_HandCrossbow_A_1",
];

describe("effective equipment", () => {
  it("act 2 inherits an act-1 slot it does not set; null empties it; act 3 sees act 1 through act 2", () => {
    const c = equipped(character("c1", "player"), {
      "1": { Helmet: "ARM_Barbarian", Cloak: "MAG_Acid_AcidMeleeCounter_Cloak", Amulet: "CHA_OutpostJewelry" },
      "2": { Cloak: null, Amulet: "DEN_BearReward_Amulet" },
    });
    const act2 = effectiveEquipment(c, "2", data);
    expect(act2.Helmet).toEqual({ item: "ARM_Barbarian", source: "1" });
    expect(act2.Cloak).toEqual({ item: null, source: "2" });
    expect(act2.Amulet).toEqual({ item: "DEN_BearReward_Amulet", source: "2" });
    expect(act2.Boots).toEqual({ item: null, source: null });
    const act3 = effectiveEquipment(c, "3", data);
    expect(act3.Helmet).toEqual({ item: "ARM_Barbarian", source: "1" });
    expect(act3.Cloak).toEqual({ item: null, source: "2" });
    expect(effectiveEquipment(c, "1", data).Amulet).toEqual({ item: "CHA_OutpostJewelry", source: "1" });
  });

  it("the Bard's instrument pick fills MusicalInstrument until an act sets it", () => {
    const probe = character("b", "player", ["Bard"]);
    const slot = resolve(probe, data).levels[0]?.slots.find((s) => s.selector.function === "SelectEquipment");
    expect(slot).toBeDefined();
    const bard = character("b", "player", ["Bard", "Bard"], [{ [slot!.id]: ["ARM_Instrument_Lute"] }]);
    expect(effectiveEquipment(bard, "1", data).MusicalInstrument).toEqual({ item: "ARM_Instrument_Lute", source: "level", level: 1 });
    expect(effectiveEquipment(bard, "3", data).MusicalInstrument).toEqual({ item: "ARM_Instrument_Lute", source: "level", level: 1 });
    const set = equipped(bard, { "2": { MusicalInstrument: "ARM_Instrument_Flute" } });
    expect(effectiveEquipment(set, "1", data).MusicalInstrument).toEqual({ item: "ARM_Instrument_Lute", source: "level", level: 1 });
    expect(effectiveEquipment(set, "2", data).MusicalInstrument).toEqual({ item: "ARM_Instrument_Flute", source: "2" });
    const emptied = equipped(bard, { "1": { MusicalInstrument: null } });
    expect(effectiveEquipment(emptied, "2", data).MusicalInstrument).toEqual({ item: null, source: "1" });
    // A Bladesinger's War and Song pick is a weapon, not an instrument.
    const subclass = { "subclass:Wizard": ["BladesingingSchool"] };
    const song = resolve(character("w", "player", ["Wizard", "Wizard"], [{}, subclass]), data).levels[1]?.slots.find((s) => s.selector.function === "SelectEquipment");
    expect(song).toBeDefined();
    const bladesinger = character("w", "player", ["Wizard", "Wizard"], [{}, { ...subclass, [song!.id]: ["WPN_Dagger"] }]);
    expect(effectiveEquipment(bladesinger, "1", data).MusicalInstrument).toEqual({ item: null, source: null });
  });
});

describe("eligible slots", () => {
  it("a shield and a light melee weapon are eligible off hand; a longsword only with DualWielder; a greatsword never", () => {
    const fighter = character("c1", "player");
    expect(eligibleSlots("MAG_ChargedLightning_StaticDischarge_Shield", fighter, data)).toEqual(["MeleeOffHand"]);
    expect(eligibleSlots("WPN_Shortsword", fighter, data)).toEqual(["MeleeMainHand", "MeleeOffHand"]);
    expect(eligibleSlots("WPN_Longsword", fighter, data)).toEqual(["MeleeMainHand"]);
    expect(eligibleSlots("WPN_Greatsword", fighter, data)).toEqual(["MeleeMainHand"]);
    const dual = character("c1", "player", ["Fighter", "Fighter", "Fighter", "Fighter"], [{}, {}, {}, { "feat:4": ["DualWielder"] }]);
    expect(eligibleSlots("WPN_Longsword", dual, data)).toEqual(["MeleeMainHand", "MeleeOffHand"]);
    expect(eligibleSlots("WPN_Greatsword", dual, data)).toEqual(["MeleeMainHand"]);
    expect(itemsForSlot("MeleeOffHand", dual, data)).toContain("WPN_Longsword");
    expect(itemsForSlot("MeleeOffHand", fighter, data)).not.toContain("WPN_Longsword");
    expect(eligibleSlots("CHA_OutpostJewelry", fighter, data)).toEqual(["Amulet"]);
    expect(eligibleSlots("DEN_Thiefling_Ring1", fighter, data)).toEqual(["Ring", "Ring2"]);
    expect(eligibleSlots("NotAnItem", fighter, data)).toEqual([]);
  });

  it("a hand crossbow is eligible RangedOffHand; RangedOffHand has no other item", () => {
    const c = character("c1", "player");
    expect(eligibleSlots("WPN_HUM_HandCrossbow_A_0", c, data)).toEqual(["RangedMainHand", "RangedOffHand"]);
    expect(itemsForSlot("RangedOffHand", c, data).sort()).toEqual(LIGHT_RANGED);
  });

  it("every data slot of rules.items has targets", () => {
    const missing = [...new Set(Object.values(data.rules.items).map((def) => def.slot))].filter((slot) => !Object.hasOwn(DATA_SLOT_TARGETS, slot));
    expect(missing).toEqual([]);
  });
});

describe("wiki data", () => {
  it("an item without wiki data has no rarity and no first act, and raises no found-later notice", () => {
    expect(Object.hasOwn(data.wiki, "WPN_Longsword")).toBe(false);
    expect(itemRarity("WPN_Longsword", data)).toBeNull();
    expect(itemFirstAct("WPN_Longsword", data)).toBeNull();
    expect(itemRarity("CHA_OutpostJewelry", data)).toBe("uncommon");
    expect(itemFirstAct("MAG_Acid_AcidMeleeCounter_Cloak", data)).toBe(2);
    expect(itemFirstAct("WPN_HUM_HandCrossbow_A_0", data)).toBe(1);
    const c = equipped(character("c1", "player"), { "1": { MeleeMainHand: "WPN_Longsword" } });
    expect(equipmentIssues(runOf(c), data)).toEqual([]);
  });
});

describe("equipment checks", () => {
  it("reports an item found only in act 2 equipped in act 1", () => {
    const c = equipped(character("c1", "player"), { "1": { Cloak: "MAG_Acid_AcidMeleeCounter_Cloak" } });
    expect(equipmentIssues(runOf(c), data)).toEqual([
      { severity: "notice", code: "itemFoundLater", character: "c1", level: null, slot: "equipment:1/Cloak", params: { item: "MAG_Acid_AcidMeleeCounter_Cloak", foundAct: 2, act: 1 } },
    ]);
    expect(validate(runOf(c), data).issues.filter((i) => i.code === "itemFoundLater")).toHaveLength(1);
  });

  it("reports the same uncommon item on two characters in one act, not a common one", () => {
    const a = equipped(character("a", "player"), { "1": { Amulet: "CHA_OutpostJewelry", Ring: "DEN_Thiefling_Ring1" } });
    const b = equipped(character("b", "Shadowheart"), { "2": { Amulet: "CHA_OutpostJewelry", Ring2: "DEN_Thiefling_Ring1" } });
    expect(equipmentIssues(runOf(a, b), data)).toEqual([
      { severity: "notice", code: "itemSharedInAct", character: "a", level: null, slot: "equipment:2/Amulet", params: { item: "CHA_OutpostJewelry", other: "Shadowheart", act: 2 } },
      { severity: "notice", code: "itemSharedInAct", character: "b", level: null, slot: "equipment:2/Amulet", params: { item: "CHA_OutpostJewelry", other: "player", act: 2 } },
    ]);
  });

  it("reports a greatsword with an item in the melee off hand", () => {
    const c = equipped(character("c1", "player"), { "1": { MeleeMainHand: "WPN_Greatsword", MeleeOffHand: "MAG_ChargedLightning_StaticDischarge_Shield" }, "3": { MeleeOffHand: null } });
    expect(equipmentIssues(runOf(c), data)).toEqual([
      { severity: "notice", code: "offHandWithTwoHanded", character: "c1", level: null, slot: "equipment:1/MeleeOffHand", params: { item: "WPN_Greatsword", act: 1 } },
    ]);
    // Shown one act at a time, the clash held since act 1 is reported again in acts 2 and 3 (the off hand is emptied in act 3).
    expect(equipmentIssues(runOf(c), data, { everyAct: true }).map((i) => i.slot)).toEqual(["equipment:1/MeleeOffHand", "equipment:2/MeleeOffHand"]);
    const longsword = equipped(character("c1", "player"), { "1": { MeleeMainHand: "WPN_Longsword", MeleeOffHand: "MAG_ChargedLightning_StaticDischarge_Shield" } });
    expect(equipmentIssues(runOf(longsword), data)).toEqual([]);
  });

  it("reports an item in a slot it cannot go to, again when the item changes", () => {
    const c = equipped(character("c1", "player"), { "1": { Helmet: "CHA_OutpostJewelry" }, "3": { Helmet: "DEN_BearReward_Amulet" } });
    expect(equipmentIssues(runOf(c), data).map((i) => [i.code, i.slot, i.params])).toEqual([
      ["itemWrongSlot", "equipment:1/Helmet", { item: "CHA_OutpostJewelry", slot: "Helmet", act: 1 }],
      ["itemWrongSlot", "equipment:3/Helmet", { item: "DEN_BearReward_Amulet", slot: "Helmet", act: 3 }],
    ]);
  });

  it("reports an unknown item id and an unknown slot key as invalid", () => {
    const c = character("c1", "player");
    c.equipment["2"] = { Helmet: "NotAnItem", Belt: "ARM_Barbarian" } as Equipment["2"];
    Object.defineProperty(c.equipment["3"], "__proto__", { value: "ARM_Barbarian", enumerable: true });
    const report = validate(runOf(c), data);
    const equipment = report.issues.filter((i) => i.slot?.startsWith("equipment:"));
    expect(equipment).toEqual([
      { severity: "invalid", code: "unknownItem", character: "c1", level: null, slot: "equipment:2/Helmet", params: { item: "NotAnItem" } },
      { severity: "invalid", code: "unknownEquipmentSlot", character: "c1", level: null, slot: "equipment:2/Belt", params: { slot: "Belt" } },
      { severity: "invalid", code: "unknownEquipmentSlot", character: "c1", level: null, slot: "equipment:3/__proto__", params: { slot: "__proto__" } },
    ]);
    expect(report.status).toBe("invalid");
  });
});
