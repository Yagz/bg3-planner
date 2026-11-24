import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData, Selector } from "../../src/data/types.ts";
import { resolve } from "../../src/engine/progression.ts";
import { validate } from "../../src/engine/validate.ts";
import { emptyRun } from "../../src/plan/model.ts";
import type { Ability, Character, Choice, Level } from "../../src/plan/model.ts";

let data: GameData;
let background: string;
beforeAll(async () => {
  data = await loadGameData("data/larian");
  background = Object.keys(data.rules.backgrounds)[0] ?? "";
});

type Scores = Record<Ability, number>;
/** 27 points: 9 + 7 + 9 + 2. */
const RANGER_SCORES: Scores = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };
/** 27 points: 9 + 4 + 9 + 5. */
const DEX12_SCORES: Scores = { Strength: 15, Dexterity: 12, Constitution: 15, Intelligence: 8, Wisdom: 13, Charisma: 8 };
/** 27 points. */
const FIGHTER_SCORES: Scores = { Strength: 15, Dexterity: 15, Constitution: 15, Intelligence: 8, Wisdom: 8, Charisma: 8 };

function character(classes: string[], choices: Record<string, Choice>[], scores: Scores, race = "Halfling", subrace: string | null = "Halfling_Lightfoot"): Character {
  const levels: Level[] = classes.map((cls, i) => ({ class: cls, choices: choices[i] ?? {} }));
  return { id: "c1", who: "player", race, subrace, background, abilities: { ...scores }, levels, items: [], notes: "" };
}

function runOf(...characters: Character[]) {
  return { ...emptyRun(), characters };
}

/** Slot id of the n-th selector with this function at a character level (looked up in the real data via `resolve`). */
function slotId(classes: string[], subclass: Record<number, Record<string, Choice>>, lvl: number, fn: Selector["function"], nth = 0): string {
  const probe = character(classes, classes.map((_, i) => subclass[i + 1] ?? {}), RANGER_SCORES);
  const slots = resolve(probe, data).levels[lvl - 1]?.slots.filter((s) => s.selector.function === fn) ?? [];
  const slot = slots[nth];
  if (slot === undefined) throw new Error(`no ${fn} #${nth} at level ${lvl}`);
  return slot.id;
}

const RANGER5 = ["Ranger", "Ranger", "Ranger", "Ranger", "Ranger"];
const GLOOM = { 3: { "subclass:Ranger": ["GloomStalker"] } };
const slot = (lvl: number, fn: Selector["function"], nth = 0) => slotId(RANGER5, GLOOM, lvl, fn, nth);

/** A complete, valid Lightfoot Halfling Gloom Stalker, Ranger 1-5. */
function rangerChoices(): Record<string, Choice>[] {
  return [
    {
      [slot(1, "SelectSkills")]: ["Stealth", "Perception", "Survival"],
      [slot(1, "SelectPassives", 0)]: ["FavoredEnemy_BountyHunter"],
      [slot(1, "SelectPassives", 1)]: ["NaturalExplorer_UrbanTracker"],
      [slot(1, "SelectAbilityBonus")]: ["Dexterity", "Wisdom"],
    },
    {
      [slot(2, "SelectSpells")]: ["Target_HuntersMark", "Target_CureWounds"],
      [slot(2, "SelectPassives")]: ["FightingStyle_Archery"],
    },
    {
      "subclass:Ranger": ["GloomStalker"],
      [slot(3, "SelectSpells")]: ["Target_Goodberry"],
    },
    {
      [slot(4, "SelectSpells")]: [],
      "feat:4": ["AbilityScoreIncrease"],
      "feat:4/0": ["Dexterity", "Dexterity"],
    },
    {
      [slot(5, "SelectSpells")]: ["Shout_PassWithoutTrace"],
    },
  ];
}

function ranger(edit: (choices: Record<string, Choice>[]) => void = () => {}, scores = RANGER_SCORES): Character {
  const choices = rangerChoices();
  edit(choices);
  return character(RANGER5, choices, scores);
}

function codes(c: Character) {
  return validate(runOf(c), data).issues.map((i) => i.code);
}

describe("validate", () => {
  it("accepts a complete Gloom Stalker Ranger 1-5", () => {
    expect(validate(runOf(ranger()), data)).toEqual({ status: "valid", issues: [] });
  });

  it("reports a choice left as todo as incomplete", () => {
    const id = slot(2, "SelectPassives");
    const report = validate(runOf(ranger((c) => { c[1]![id] = "todo"; })), data);
    expect(report).toEqual({
      status: "incomplete",
      issues: [{ severity: "incomplete", code: "choiceMissing", character: "c1", level: 2, slot: id, params: { selector: "SelectPassives" } }],
    });
  });

  it("reports a missing choice as incomplete", () => {
    const id = slot(5, "SelectSpells");
    const report = validate(runOf(ranger((c) => { delete c[4]![id]; })), data);
    expect(report.status).toBe("incomplete");
    expect(report.issues.map((i) => [i.code, i.slot])).toEqual([["choiceMissing", id]]);
  });

  it("rejects a spell that is not in the selector's list", () => {
    const id = slot(2, "SelectSpells");
    const list = data.rules.progressions.find((p) => id.startsWith(p.uuid))?.selectors[0]?.list;
    const report = validate(runOf(ranger((c) => { c[1]![id] = ["Target_HuntersMark", "Target_MistyStep"]; })), data);
    expect(report).toEqual({
      status: "invalid",
      issues: [{ severity: "invalid", code: "notInList", character: "c1", level: 2, slot: id, params: { item: "Target_MistyStep", list: list ?? "" } }],
    });
  });

  it("rejects a wrong number of picks and a duplicated pick", () => {
    const id = slot(1, "SelectSkills");
    expect(codes(ranger((c) => { c[0]![id] = ["Stealth", "Perception"]; }))).toEqual(["wrongCount"]);
    expect(codes(ranger((c) => { c[0]![id] = ["Stealth", "Stealth", "Survival"]; }))).toEqual(["duplicateChoice"]);
  });

  it("rejects an ability bonus given twice to the same ability or with the wrong count", () => {
    const id = slot(1, "SelectAbilityBonus");
    expect(codes(ranger((c) => { c[0]![id] = ["Dexterity", "Dexterity"]; }))).toContain("duplicateChoice");
    expect(codes(ranger((c) => { c[0]![id] = ["Dexterity"]; }))).toContain("wrongCount");
  });

  it("rejects a spell picked again when already known", () => {
    const id = slot(5, "SelectSpells");
    const report = validate(runOf(ranger((c) => { c[4]![id] = ["Target_CureWounds"]; })), data);
    expect(report.issues).toEqual([
      { severity: "invalid", code: "alreadyKnown", character: "c1", level: 5, slot: id, params: { item: "Target_CureWounds" } },
    ]);
  });

  it("needs no choice for a selector with count 0, but still checks one that is present", () => {
    const id = slot(4, "SelectSpells");
    expect(validate(runOf(ranger((c) => { delete c[3]![id]; })), data)).toEqual({ status: "valid", issues: [] });
    expect(validate(runOf(ranger((c) => { c[3]![id] = "todo"; })), data).issues.map((i) => i.code)).toEqual(["choiceMissing"]);
    expect(validate(runOf(ranger((c) => { c[3]![id] = ["Target_HuntersMark>Target_Jump"]; })), data).status).toBe("valid");
    expect(codes(ranger((c) => { c[3]![id] = ["Target_Jump"]; }))).toEqual(["wrongCount"]);
  });

  it("scopes known spells by class: the same spell picked in two classes is valid, twice in one class is not", () => {
    const classes = ["Ranger", "Ranger", "Bard"];
    const rangerSpells = slotId(classes, {}, 2, "SelectSpells");
    const bardSpells = slotId(classes, {}, 3, "SelectSpells", 1);
    const choices: Record<string, Choice>[] = [{}, { [rangerSpells]: ["Target_HuntersMark", "Target_CureWounds"] }, { [bardSpells]: ["Target_CureWounds", "Target_HealingWord", "Target_Sleep", "Zone_Thunderwave"] }];
    const issues = validate(runOf(character(classes, choices, RANGER_SCORES)), data).issues;
    expect(issues.filter((i) => i.severity === "invalid")).toEqual([]);
    // Same class twice: the alreadyKnown test above (Target_CureWounds at Ranger 2 and Ranger 5).
    expect(codes(ranger((c) => { c[4]![slot(5, "SelectSpells")] = ["Target_CureWounds"]; }))).toEqual(["alreadyKnown"]);
  });

  it("does not count a race's granted spell as known for a class pick", () => {
    const classes = ["Cleric"];
    const cantrips = slotId(classes, {}, 1, "SelectSpells");
    const choices: Record<string, Choice>[] = [{ [cantrips]: ["Shout_ProduceFlame", "Target_Guidance", "Shout_Thaumaturgy"] }];
    const issues = validate(runOf(character(classes, choices, RANGER_SCORES, "Tiefling", "Tiefling_Asmodeus")), data).issues;
    expect(issues.filter((i) => i.slot === cantrips)).toEqual([]);
  });

  it("keeps race picks in their own spell scope, apart from the class", () => {
    const probe = character(["Wizard"], [{}], RANGER_SCORES, "Elf", "Elf_HighElf");
    const slots = resolve(probe, data).levels[0]?.slots ?? [];
    const raceRows = new Set(data.rules.progressions.filter((p) => p.type === "race").map((p) => p.uuid));
    const raceCantrip = slots.find((s) => s.selector.function === "SelectSpells" && raceRows.has(s.progression))?.id ?? "";
    const classCantrips = slots.find((s) => s.selector.function === "SelectSpells" && !raceRows.has(s.progression))?.id ?? "";
    expect(raceCantrip).not.toBe("");
    const choices: Record<string, Choice>[] = [{ [classCantrips]: ["Projectile_AcidSplash", "Projectile_FireBolt", "Projectile_RayOfFrost"], [raceCantrip]: ["Projectile_AcidSplash"] }];
    const issues = validate(runOf(character(["Wizard"], choices, RANGER_SCORES, "Elf", "Elf_HighElf")), data).issues;
    expect(issues.filter((i) => i.slot === raceCantrip || i.slot === classCantrips)).toEqual([]);
  });

  it("does not count a class or subclass grant as known for a pick", () => {
    const classes = ["Cleric"];
    const light = { 1: { "subclass:Cleric": ["LightDomain"] } };
    const cantrips = slotId(classes, light, 1, "SelectSpells");
    const choices: Record<string, Choice>[] = [{ "subclass:Cleric": ["LightDomain"], [cantrips]: ["Target_Light", "Target_Guidance", "Shout_Thaumaturgy"] }];
    const issues = validate(runOf(character(classes, choices, RANGER_SCORES)), data).issues;
    expect(issues.filter((i) => i.slot === cantrips)).toEqual([]);
  });

  it("treats ReplacePassives as an optional change of the held passive", () => {
    const classes = ["Barbarian", "Barbarian", "Barbarian", "Barbarian", "Barbarian"];
    const totem = { 3: { "subclass:Barbarian": ["TotemWarriorPath"] } };
    const pick = slotId(classes, totem, 3, "SelectPassives");
    const replace4 = slotId(classes, totem, 4, "ReplacePassives");
    const replace5 = slotId(classes, totem, 5, "ReplacePassives");
    const passiveIssues = (at4?: Choice, at5?: Choice) => {
      const choices: Record<string, Choice>[] = [{}, {}, { "subclass:Barbarian": ["TotemWarriorPath"], [pick]: ["TotemSpirit_Bear"] }, {}, {}];
      if (at4 !== undefined) choices[3]![replace4] = at4;
      if (at5 !== undefined) choices[4]![replace5] = at5;
      return validate(runOf(character(classes, choices, FIGHTER_SCORES, "Human", null)), data).issues.filter((i) => i.slot === replace4 || i.slot === replace5);
    };
    // Keeping the totem: the key is left out, or no replacement is listed.
    expect(passiveIssues()).toEqual([]);
    expect(passiveIssues([])).toEqual([]);
    expect(passiveIssues("todo").map((i) => i.code)).toEqual(["choiceMissing"]);
    // Replacing it: the new one is held, the old one can come back.
    expect(passiveIssues(["TotemSpirit_Wolf"])).toEqual([]);
    expect(passiveIssues(["TotemSpirit_Wolf"], ["TotemSpirit_Bear"])).toEqual([]);
    expect(passiveIssues(["TotemSpirit_Wolf"], ["TotemSpirit_Wolf"])).toEqual([
      { severity: "invalid", code: "alreadyKnown", character: "c1", level: 5, slot: replace5, params: { item: "TotemSpirit_Wolf" } },
    ]);
    expect(passiveIssues(["TotemSpirit_Bear"])).toEqual([
      { severity: "invalid", code: "alreadyKnown", character: "c1", level: 4, slot: replace4, params: { item: "TotemSpirit_Bear" } },
    ]);
    expect(passiveIssues(["TotemSpirit_Wolf", "TotemSpirit_Elk"]).map((i) => [i.code, i.params])).toEqual([["wrongCount", { count: 2, max: 1 }]]);
  });

  it("stops counting a replaced passive's armour proficiency", () => {
    // Synthetic: the Bear totem is given Heavy Armor proficiency so that replacing it matters for HeavyArmorMaster.
    const patched: GameData = structuredClone(data);
    patched.rules.passives["TotemSpirit_Bear"] = { boosts: ["Proficiency(HeavyArmor)"] };
    const classes = ["Barbarian", "Barbarian", "Barbarian", "Barbarian"];
    const totem = { 3: { "subclass:Barbarian": ["TotemWarriorPath"] } };
    const pick = slotId(classes, totem, 3, "SelectPassives");
    const replace4 = slotId(classes, totem, 4, "ReplacePassives");
    const notMet = (replacement?: string[]) => {
      const choices: Record<string, Choice>[] = [{}, {}, { "subclass:Barbarian": ["TotemWarriorPath"], [pick]: ["TotemSpirit_Bear"] }, { "feat:4": ["HeavyArmorMaster"] }];
      if (replacement !== undefined) choices[3]![replace4] = replacement;
      return validate(runOf(character(classes, choices, FIGHTER_SCORES, "Human", null)), patched).issues.filter((i) => i.code === "requirementNotMet");
    };
    expect(notMet()).toEqual([]);
    expect(notMet(["TotemSpirit_Wolf"]).map((i) => i.params["proficiency"])).toEqual(["HeavyArmor"]);
  });

  it("accepts a swap of a known spell, written old>new, besides the new picks", () => {
    const id = slot(3, "SelectSpells");
    expect(validate(runOf(ranger((c) => { c[2]![id] = ["Target_Goodberry", "Target_HuntersMark>Target_Jump"]; })), data)).toEqual({ status: "valid", issues: [] });
    // The swapped-out spell can be picked again later; the swapped-in one is known.
    const id5 = slot(5, "SelectSpells");
    const later = ranger((c) => {
      c[2]![id] = ["Target_Goodberry", "Target_HuntersMark>Target_Jump"];
      c[4]![id5] = ["Target_HuntersMark"];
    });
    expect(validate(runOf(later), data).status).toBe("valid");
    const again = ranger((c) => {
      c[2]![id] = ["Target_Goodberry", "Target_HuntersMark>Target_Jump"];
      c[4]![id5] = ["Target_Jump"];
    });
    expect(codes(again)).toEqual(["alreadyKnown"]);
  });

  it("rejects a swap of a spell that is not known", () => {
    const id = slot(3, "SelectSpells");
    const report = validate(runOf(ranger((c) => { c[2]![id] = ["Target_Goodberry", "Target_Longstrider>Target_Jump"]; })), data);
    expect(report.issues).toEqual([
      { severity: "invalid", code: "swapNotKnown", character: "c1", level: 3, slot: id, params: { item: "Target_Longstrider" } },
    ]);
  });

  it("rejects more swaps than the selector allows", () => {
    const id = slot(3, "SelectSpells");
    const report = validate(runOf(ranger((c) => { c[2]![id] = ["Target_Goodberry", "Target_HuntersMark>Target_Jump", "Target_CureWounds>Target_FogCloud"]; })), data);
    expect(report.issues).toEqual([
      { severity: "invalid", code: "tooManySwaps", character: "c1", level: 3, slot: id, params: { count: 2, max: 1 } },
    ]);
    const id2 = slot(2, "SelectSpells");
    expect(codes(ranger((c) => { c[1]![id2] = ["Target_HuntersMark", "Target_CureWounds", "Target_Jump>Target_FogCloud"]; }))).toContain("tooManySwaps");
  });

  it("flags an off-data choice as a notice without changing the status", () => {
    const id = slot(2, "SelectPassives");
    const report = validate(runOf(ranger((c) => { c[1]![id] = { offData: "Modded fighting style" }; })), data);
    expect(report).toEqual({
      status: "valid",
      issues: [{ severity: "notice", code: "offData", character: "c1", level: 2, slot: id, params: { selector: "SelectPassives" } }],
    });
  });

  it("rejects an unknown slot id and a choice on an AddSpells grant", () => {
    const report = validate(runOf(ranger((c) => { c[1]!["00000000-0000-0000-0000-000000000000/0"] = ["Target_Jump"]; })), data);
    expect(report).toEqual({
      status: "invalid",
      issues: [{ severity: "invalid", code: "unknownSlot", character: "c1", level: 2, slot: "00000000-0000-0000-0000-000000000000/0", params: {} }],
    });
    const grant = slot(3, "AddSpells");
    expect(validate(runOf(ranger((c) => { c[2]![grant] = ["Shout_UmbralCloak"]; })), data).issues).toEqual([
      { severity: "invalid", code: "unknownSlot", character: "c1", level: 3, slot: grant, params: {} },
    ]);
    // A feat key outside a feat level, a subclass key outside the subclass level.
    expect(codes(ranger((c) => { c[2]!["feat:3"] = ["AbilityScoreIncrease"]; }))).toEqual(["unknownSlot"]);
    expect(codes(ranger((c) => { c[1]!["subclass:Ranger"] = ["GloomStalker"]; }))).toEqual(["unknownSlot"]);
  });

  it("reports a missing feat as incomplete and an unknown feat as invalid", () => {
    const missing = ranger((c) => { delete c[3]!["feat:4"]; delete c[3]!["feat:4/0"]; });
    expect(validate(runOf(missing), data).issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: 4, slot: "feat:4", params: {} },
    ]);
    const unknown = ranger((c) => { c[3]!["feat:4"] = ["__proto__"]; delete c[3]!["feat:4/0"]; });
    expect(validate(runOf(unknown), data).issues).toEqual([
      { severity: "invalid", code: "unknownFeat", character: "c1", level: 4, slot: "feat:4", params: { feat: "__proto__" } },
    ]);
    expect(codes(ranger((c) => { c[3]!["feat:4"] = ["AbilityScoreIncrease", "Alert"]; delete c[3]!["feat:4/0"]; }))).toEqual(["wrongCount"]);
  });

  it("requires the chosen feat's own selectors", () => {
    expect(validate(runOf(ranger((c) => { delete c[3]!["feat:4/0"]; })), data).issues).toEqual([
      { severity: "incomplete", code: "choiceMissing", character: "c1", level: 4, slot: "feat:4/0", params: { selector: "SelectAbilities" } },
    ]);
    expect(codes(ranger((c) => { c[3]!["feat:4/0"] = ["Dexterity"]; }))).toEqual(["wrongCount"]);
  });

  it("rejects a feat requiring Dexterity 13 with Dexterity 12", () => {
    const report = validate(runOf(ranger((c) => {
      c[0]![slot(1, "SelectAbilityBonus")] = ["Strength", "Constitution"];
      c[3]!["feat:4"] = ["DefensiveDuelist"];
      delete c[3]!["feat:4/0"];
    }, DEX12_SCORES)), data);
    expect(report.issues).toEqual([
      { severity: "invalid", code: "requirementNotMet", character: "c1", level: 4, slot: "feat:4", params: { feat: "DefensiveDuelist", requirement: "ability_min", ability: "Dexterity", value: 13, actual: 12 } },
    ]);
  });

  it("rejects an ability increase pushing a score to 21", () => {
    const fighter = ["Fighter", "Fighter", "Fighter", "Fighter", "Fighter", "Fighter"];
    const bonus = slotId(fighter, {}, 1, "SelectAbilityBonus");
    const choices: Record<string, Choice>[] = [
      { [bonus]: ["Dexterity", "Strength"] },
      {},
      {},
      { "feat:4": ["AbilityScoreIncrease"], "feat:4/0": ["Dexterity", "Dexterity"] },
      {},
      { "feat:6": ["AbilityScoreIncrease"], "feat:6/0": ["Dexterity", "Dexterity"] },
    ];
    const issues = validate(runOf(character(fighter, choices, FIGHTER_SCORES)), data).issues;
    expect(issues.filter((i) => i.code === "abilityAboveMax")).toEqual([
      { severity: "invalid", code: "abilityAboveMax", character: "c1", level: 6, slot: "feat:6/0", params: { ability: "Dexterity", value: 21 } },
    ]);
  });

  it("rejects a non-repeatable feat taken twice", () => {
    const fighter = ["Fighter", "Fighter", "Fighter", "Fighter", "Fighter", "Fighter"];
    const choices: Record<string, Choice>[] = [{}, {}, {}, { "feat:4": ["Alert"] }, {}, { "feat:6": ["Alert"] }];
    const issues = validate(runOf(character(fighter, choices, FIGHTER_SCORES)), data).issues;
    expect(issues.filter((i) => i.code === "featAlreadyTaken")).toEqual([
      { severity: "invalid", code: "featAlreadyTaken", character: "c1", level: 6, slot: "feat:6", params: { feat: "Alert" } },
    ]);
  });

  it("lets ModeratelyArmored follow LightlyArmored, and not without it", () => {
    const wizard = Array.from({ length: 8 }, () => "Wizard");
    const notMet = (choices: Record<string, Choice>[], race?: string, subrace?: string | null) =>
      validate(runOf(character(wizard, choices, RANGER_SCORES, race, subrace)), data).issues.filter((i) => i.code === "requirementNotMet");
    const direct: Record<string, Choice>[] = [{}, {}, {}, { "feat:4": ["ModeratelyArmored"], "feat:4/0": ["Dexterity"] }];
    expect(notMet(direct)).toEqual([
      { severity: "invalid", code: "requirementNotMet", character: "c1", level: 4, slot: "feat:4", params: { feat: "ModeratelyArmored", requirement: "proficiency", proficiency: "LightArmor" } },
    ]);
    const path: Record<string, Choice>[] = [{}, {}, {}, { "feat:4": ["LightlyArmored"], "feat:4/0": ["Dexterity"] }, {}, {}, {}, { "feat:8": ["ModeratelyArmored"], "feat:8/0": ["Dexterity"] }];
    expect(notMet(path)).toEqual([]);
    // A Human gets Light Armor from the HumanMilitia passive of its race row.
    expect(notMet(direct, "Human", null)).toEqual([]);
  });

  it("counts armour proficiency granted by a picked passive", () => {
    const choices = rangerChoices();
    choices[0]![slot(1, "SelectPassives", 0)] = ["FavoredEnemy_RangerKnight"];
    choices[3]!["feat:4"] = ["HeavyArmorMaster"];
    delete choices[3]!["feat:4/0"];
    const issues = validate(runOf(character(RANGER5, choices, RANGER_SCORES)), data).issues;
    expect(issues.filter((i) => i.code === "requirementNotMet")).toEqual([]);
    choices[0]![slot(1, "SelectPassives", 0)] = ["FavoredEnemy_BountyHunter"];
    const without = validate(runOf(character(RANGER5, choices, RANGER_SCORES)), data).issues;
    expect(without.filter((i) => i.code === "requirementNotMet").map((i) => i.params["proficiency"])).toEqual(["HeavyArmor"]);
  });

  it("includes point buy and resolution issues, per character", () => {
    const bad = { ...ranger(), id: "c2", abilities: { ...RANGER_SCORES, Charisma: 8 } };
    const report = validate(runOf(ranger(), bad), data);
    expect(report).toEqual({
      status: "valid",
      issues: [{ severity: "notice", code: "pointBuyUnderBudget", character: "c2", level: null, slot: null, params: { spent: 25, budget: 27 } }],
    });
    const noSub = ranger((c) => { c[2]!["subclass:Ranger"] = "todo"; });
    expect(validate(runOf(noSub), data).issues.map((i) => [i.code, i.slot])).toEqual([["choiceMissing", "subclass:Ranger"]]);
  });
});

describe("validate, duplicate progression rows of the game", () => {
  // The game applies every row of a duplicate group; a selector identical to one of an earlier row counts once.
  const BM_A = "01115231-fa37-4cd2-b750-5f282c8ab667";
  const BM_B = "59505762-9251-463c-a81b-420e9a14c8cd";
  const CLERIC_A = "2b249feb-bba5-4922-8385-c2dd9baaa049";
  const CLERIC_B = "366cde9c-db0c-43ce-a49c-fb140e084b3c";
  const FIGHTER1 = "dfb2fd83-9849-4c2d-be84-adedb81a867a";
  const DEATH1 = "bcdcfb06-09b9-4299-81b4-aa83e1ffd034";
  const fighter1 = (): Record<string, Choice> => ({
    [`${FIGHTER1}/0`]: ["Athletics", "Perception"],
    [`${FIGHTER1}/2`]: ["FightingStyle_Defense"],
    [`${FIGHTER1}/3`]: ["Strength", "Constitution"],
  });
  const maneuvers = ["CommanderStrike_Maneuver", "DisarmingAttack", "DistractingStrike"];
  const battleMaster = (third: Record<string, Choice>) =>
    character(["Fighter", "Fighter", "Fighter"], [fighter1(), {}, { "subclass:Fighter": ["BattleMaster"], ...third }], FIGHTER_SCORES);
  const summary = (c: Character) => {
    const report = validate(runOf(c), data);
    return { status: report.status, issues: report.issues.map((i) => [i.severity, i.code, i.slot]) };
  };

  it("accepts a BattleMaster 3 with its 3 maneuvers in the one remaining slot, without notice", () => {
    expect(summary(battleMaster({ [`${BM_A}/0`]: maneuvers }))).toEqual({ status: "valid", issues: [] });
  });

  it("asks for the maneuvers once, in the first row's slot", () => {
    expect(summary(battleMaster({}))).toEqual({ status: "incomplete", issues: [["incomplete", "choiceMissing", `${BM_A}/0`]] });
  });

  it("rejects a second set of maneuvers on the merged-away row's slot as an unknown slot", () => {
    const both = battleMaster({ [`${BM_A}/0`]: maneuvers, [`${BM_B}/0`]: ["EvasiveFootwork", "FeintingAttack", "GoadingAttack"] });
    expect(summary(both)).toEqual({ status: "invalid", issues: [["invalid", "unknownSlot", `${BM_B}/0`]] });
  });

  const cantrips = ["Target_Guidance", "Target_Light", "Target_SacredFlame"];
  const clericAt2 = (cleric: Record<string, Choice>) => character(["Fighter", "Cleric"], [fighter1(), cleric], FIGHTER_SCORES);

  it("requires the 2 skills and the 3 cantrips of a Cleric taken at level 2, in the first row's slots", () => {
    expect(summary(clericAt2({ "subclass:Cleric": ["WarDomain"] }))).toEqual({
      status: "incomplete",
      issues: [
        ["incomplete", "choiceMissing", `${CLERIC_A}/0`],
        ["incomplete", "choiceMissing", `${CLERIC_A}/1`],
      ],
    });
    const cleric = resolve(clericAt2({}), data).levels[1];
    expect(cleric?.rows.map((r) => r.uuid)).toEqual(expect.arrayContaining([CLERIC_A, CLERIC_B]));
    expect(cleric?.slots.some((s) => s.progression === CLERIC_B)).toBe(false);
  });

  it("accepts a domain of either row for a Cleric taken at level 2", () => {
    const base = { [`${CLERIC_A}/0`]: ["Insight", "Medicine"], [`${CLERIC_A}/1`]: cantrips };
    expect(summary(clericAt2({ ...base, "subclass:Cleric": ["WarDomain"] }))).toEqual({ status: "valid", issues: [] });
    expect(summary(clericAt2({ ...base, "subclass:Cleric": ["LifeDomain"] }))).toEqual({ status: "valid", issues: [] });
    const death = { ...base, "subclass:Cleric": ["DeathDomain"], [`${DEATH1}/0`]: ["Target_ChillTouch"] };
    expect(summary(clericAt2(death))).toEqual({ status: "valid", issues: [] });
  });

  it("rejects cantrips on the merged-away Cleric row's slot as an unknown slot", () => {
    const stale = { [`${CLERIC_A}/0`]: ["Insight", "Medicine"], [`${CLERIC_A}/1`]: cantrips, [`${CLERIC_B}/0`]: cantrips, "subclass:Cleric": ["WarDomain"] };
    expect(summary(clericAt2(stale))).toEqual({ status: "invalid", issues: [["invalid", "unknownSlot", `${CLERIC_B}/0`]] });
  });

  it("grants the armour and weapon proficiencies of both Cleric rows", () => {
    const cleric = resolve(clericAt2({}), data).levels[1];
    const boosts = new Set(cleric?.rows.flatMap((r) => r.boosts));
    for (const p of ["LightArmor", "MediumArmor", "Shields", "Morningstars", "Flails"]) expect(boosts.has(`Proficiency(${p})`)).toBe(true);
  });
});
