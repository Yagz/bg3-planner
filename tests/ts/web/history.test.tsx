import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { toReadableJson } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import HistoryPanel from "../../../web/src/screens/HistoryPanel.tsx";
import { stubData, text } from "./stubData.ts";

afterEach(cleanup);

function run(equipment: Record<string, string | null>, prepared?: string[]): Run {
  const r = emptyRun("r");
  r.characters.push({
    id: "c1",
    who: "player",
    race: "Human",
    subrace: null,
    background: "Soldier",
    abilities: { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 },
    levels: [{ class: "Cleric", choices: {}, ...(prepared === undefined ? {} : { prepared }) }],
    equipment: { "1": {}, "2": equipment, "3": {} },
    notes: "",
  });
  return r;
}

const data = () =>
  stubData({
    "slot:Breast": text("Attire"),
    "item:ARM_Old": text("Old Vest"),
    "item:ARM_New": text("New Robe"),
    "class:Cleric": text("Cleric"),
    "spell:Sanctuary": text("Sanctuary"),
  });

function versions(...runs: Run[]) {
  return runs.map((r, i) => ({ at: new Date(2026, 0, 1, 0, 0, runs.length - i).toISOString(), text: toReadableJson(r, {}, undefined) }));
}

describe("HistoryPanel", () => {
  it("an equipment change reads Equipment · act 2 · slot: before → after", () => {
    render(<HistoryPanel data={data()} name="Run" versions={versions(run({ Breast: "ARM_New" }), run({ Breast: "ARM_Old" }))} onRestore={() => {}} />);
    expect(screen.getByText((_, el) => el?.className === "diffline" && el.textContent === "Player: Equipment · act 2 · Attire: Old Vest → New Robe")).toBeTruthy();
  });

  it("emptying and inheriting are told apart", () => {
    render(<HistoryPanel data={data()} name="Run" versions={versions(run({ Breast: null }), run({ Breast: "ARM_Old" }), run({}))} onRestore={() => {}} />);
    const lines = [...document.querySelectorAll(".diffline")].map((el) => el.textContent);
    expect(lines).toContain("Player: Equipment · act 2 · Attire: Old Vest → Empty");
    expect(lines).toContain("Player: Equipment · act 2 · Attire: inherited from act 1 → Old Vest");
  });

  it("a prepared-spells change names the spells added at its level and class", () => {
    render(<HistoryPanel data={data()} name="Run" versions={versions(run({}, ["Sanctuary"]), run({}, []))} onRestore={() => {}} />);
    expect([...document.querySelectorAll(".diffline")].map((el) => el.textContent)).toContain("Player: Prepared spells · level 1 (Cleric 1): Sanctuary added");
  });
});
