import { beforeAll, describe, expect, it } from "vitest";
import { loadGameData } from "../../src/data/load.ts";
import type { GameData } from "../../src/data/types.ts";
import { abilityTotals, checkPointBuy, pointsSpent, POINT_BUY } from "../../src/engine/abilities.ts";
import { reportFrom } from "../../src/engine/issues.ts";
import type { Issue } from "../../src/engine/issues.ts";
import type { Ability, Character } from "../../src/plan/model.ts";

let data: GameData;
beforeAll(async () => {
  data = await loadGameData("data/larian");
});

function character(scores: number[], levels: Character["levels"] = []): Character {
  const names = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"] as const;
  const abilities = Object.fromEntries(names.map((n, i) => [n, scores[i] ?? 8])) as Record<Ability, number>;
  return { id: "c1", who: "player", race: "", subrace: null, background: "", abilities, levels, items: [], notes: "" };
}

describe("checkPointBuy", () => {
  it("accepts exactly 27 points", () => {
    expect(checkPointBuy(character([15, 15, 15, 8, 8, 8]))).toEqual([]);
  });
  it("rejects 28 points", () => {
    const issues = checkPointBuy(character([15, 15, 15, 9, 8, 8]));
    expect(issues).toEqual([
      { severity: "invalid", code: "pointBuyOverBudget", character: "c1", level: null, slot: null, params: { spent: 28, budget: 27 } },
    ]);
  });
  it("reports a score of 16 as out of range without costing it", () => {
    const issues = checkPointBuy(character([16, 8, 8, 8, 8, 8]));
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ severity: "invalid", code: "abilityOutOfRange", params: { ability: "Strength", value: 16 } });
    expect(issues.map((i) => i.code)).toContain("pointBuyUnderBudget");
    expect(issues.map((i) => i.code)).not.toContain("pointBuyOverBudget");
  });
  it("reports a score below 8 and a non-integer", () => {
    const codes = checkPointBuy(character([7, 8.5, 8, 8, 8, 8])).filter((i) => i.code === "abilityOutOfRange");
    expect(codes).toHaveLength(2);
  });
  it("gives a notice when under budget", () => {
    const issues = checkPointBuy(character([10, 10, 10, 10, 10, 10]));
    expect(issues).toEqual([
      { severity: "notice", code: "pointBuyUnderBudget", character: "c1", level: null, slot: null, params: { spent: 12, budget: 27 } },
    ]);
  });
  it("exposes the table", () => {
    expect(POINT_BUY.budget).toBe(27);
    expect(POINT_BUY.cost[15]).toBe(9);
  });
});

describe("abilityTotals", () => {
  const ranger = () => {
    const table = data.rules.classes["Ranger"]?.table;
    const row = data.rules.progressions.find(
      (p) => p.table === table && p.level === 1 && !p.multiclass && p.selectors.some((s) => s.function === "SelectAbilityBonus"),
    );
    if (!row) throw new Error("no Ranger row");
    return { uuid: row.uuid, index: row.selectors.findIndex((s) => s.function === "SelectAbilityBonus") };
  };

  it("applies +2/+1 at level 1 and an ASI at level 4", () => {
    const { uuid, index } = ranger();
    const levels: Character["levels"] = [
      { class: "Ranger", choices: { [`${uuid}/${index}`]: ["Dexterity", "Wisdom"] } },
      { class: "Ranger", choices: {} },
      { class: "Ranger", choices: {} },
      { class: "Ranger", choices: { "feat:4": ["AbilityScoreIncrease"], "feat:4/0": ["Dexterity", "Dexterity"] } },
    ];
    const c = character([10, 15, 14, 8, 12, 8], levels);
    expect(abilityTotals(c, data, 1)).toMatchObject({ Dexterity: 17, Wisdom: 13, Strength: 10 });
    expect(abilityTotals(c, data, 3)).toMatchObject({ Dexterity: 17, Wisdom: 13 });
    expect(abilityTotals(c, data, 4)).toMatchObject({ Dexterity: 19, Wisdom: 13 });
  });
  it("splits an ASI across two abilities and caps at 20", () => {
    const levels: Character["levels"] = [
      { class: "Ranger", choices: { "feat:1": ["AbilityScoreIncrease"], "feat:1/0": ["Strength", "Wisdom"] } },
      { class: "Ranger", choices: { "feat:2": ["AbilityScoreIncrease"], "feat:2/0": ["Wisdom", "Wisdom"] } },
    ];
    const c = character([8, 8, 8, 8, 19, 8], levels);
    const t = abilityTotals(c, data, 2);
    expect(t.Strength).toBe(9);
    expect(t.Wisdom).toBe(20);
  });
  it("skips what it cannot use", () => {
    const { uuid, index } = ranger();
    const levels: Character["levels"] = [
      {
        class: "Ranger",
        choices: {
          [`${uuid}/${index}`]: "todo",
          "bad": ["Strength"],
          "feat:1": { offData: "x" },
          "feat:1/0": ["Strength", "Strength"],
          "nope/0": ["Strength"],
          [`${uuid}/99`]: ["Strength"],
          "feat:2/0": ["Strength"],
        },
      },
      { class: "Ranger", choices: { "feat:2": ["NoSuchFeat"], "feat:2/0": ["Strength"], [`${uuid}/${index}`]: ["Bogus", "Strength"] } },
    ];
    const c = character([10, 10, 10, 10, 10, 10], levels);
    expect(abilityTotals(c, data, 2)).toEqual({ Strength: 10, Dexterity: 10, Constitution: 10, Intelligence: 10, Wisdom: 10, Charisma: 10 });
  });
});

describe("reportFrom", () => {
  const mk = (severity: Issue["severity"]): Issue => ({ severity, code: "choiceMissing", character: "c", level: null, slot: null, params: {} });
  it("takes the worst severity and ignores notices", () => {
    expect(reportFrom([]).status).toBe("valid");
    expect(reportFrom([mk("notice")]).status).toBe("valid");
    expect(reportFrom([mk("notice"), mk("incomplete")]).status).toBe("incomplete");
    expect(reportFrom([mk("incomplete"), mk("invalid")]).status).toBe("invalid");
  });
});

describe("pointsSpent", () => {
  it("counts the point-buy cost of the base scores", () => {
    expect(pointsSpent(character([15, 15, 15, 8, 8, 8]).abilities)).toBe(27);
    expect(pointsSpent(character([8, 8, 8, 8, 8, 8]).abilities)).toBe(0);
    expect(pointsSpent(character([14, 13, 8, 8, 8, 8]).abilities)).toBe(12);
  });
  it("leaves a score outside the point-buy range uncounted", () => {
    expect(pointsSpent(character([16, 8, 8, 8, 8, 8]).abilities)).toBe(0);
  });
});
