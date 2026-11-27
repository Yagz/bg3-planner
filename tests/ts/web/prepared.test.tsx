import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { preparedState } from "../../../src/engine/prepared.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { gameName } from "../../../web/src/names.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});
afterEach(cleanup);

/** A Cleric of `levels` levels (Wisdom 16: modifier +3), with the prepared lists given by character level. */
function cleric(levels: number, prepared: Record<number, string[]> = {}, classes: string[] = []): Character {
  return {
    id: "cleric",
    who: "player",
    race: "Human",
    subrace: null,
    background: Object.keys(data.rules.backgrounds)[0]!,
    abilities: { Strength: 10, Dexterity: 10, Constitution: 14, Intelligence: 8, Wisdom: 16, Charisma: 10 },
    levels: Array.from({ length: levels }, (_, i) => ({ class: classes[i] ?? "Cleric", choices: {} as Record<string, Choice>, ...(prepared[i + 1] === undefined ? {} : { prepared: prepared[i + 1]! }) })),
    equipment: { "1": {}, "2": {}, "3": {} },
    notes: "",
  };
}

function setup(character: Character) {
  const run: Run = emptyRun("r");
  run.characters = [character];
  run.party["1"].active = [character.id];
  const store = createStore(new MemoryBackend());
  const saved = store.save(run);
  window.history.replaceState(null, "", `#/character/${character.id}`);
  render(<App data={data} store={store} settingsBackend={new MemoryBackend()} sessionBackend={new MemoryBackend()} />);
  return { store, runId: saved.id };
}

const name = (id: string) => gameName(data, "en", "spell", id);
const row = (level: number) => screen.getByRole("group", { name: `Level ${level}` });
const pool = (character: Character, level = 1) => preparedState(character, data, level)!.pool;

describe("Prepared spells in the level list", () => {
  it("a Cleric level shows Prepared spells with count, formula and spell chips", () => {
    const [a, b] = pool(cleric(1));
    setup(cleric(1, { 1: [a!, b!] }));
    const level = within(row(1));
    expect(level.getByText("Prepared spells")).toBeTruthy();
    expect(level.getByText("2 / 4")).toBeTruthy();
    expect(level.getByText("Cleric level 1 + Wisdom modifier, at least 1")).toBeTruthy();
    expect(level.getByText(name(a!))).toBeTruthy();
    expect(level.getByText(name(b!))).toBeTruthy();
  });

  it("an inheriting level says it takes the list of level 1; a spell new at this level has the new mark", () => {
    const spells = pool(cleric(3), 3);
    const first = spells.find((s) => pool(cleric(1)).includes(s))!;
    const added = spells.find((s) => !pool(cleric(1)).includes(s))!;
    setup(cleric(3, { 1: [first], 3: [first, added] }));
    expect(within(row(2)).getByText("Takes the list of level 1")).toBeTruthy();
    expect(within(row(2)).queryByText("new")).toBeNull();
    const own = within(row(3));
    expect(own.queryByText("Takes the list of level 1")).toBeNull();
    expect(own.getAllByText("new")).toHaveLength(1);
    expect(own.getByText(name(added)).closest(".sp")!.classList.contains("new")).toBe(true);
  });

  it("Edit opens the spell picker grouped by level with the pool only", () => {
    const c = cleric(3);
    setup(c);
    fireEvent.click(within(row(1)).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("group", { name: "Level 1" })).toBeTruthy();
    expect(within(dialog).queryByRole("group", { name: "Level 2" })).toBeNull();
    const boxes = within(dialog).getAllByRole("checkbox").filter((box) => box.getAttribute("aria-label") !== "A value outside the game data");
    expect(boxes.map((box) => box.getAttribute("aria-label")).sort()).toEqual(pool(c, 1).map(name).sort());
    // Level 3 offers the level-2 spells too.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(row(3)).getByRole("button", { name: "Edit" }));
    expect(within(screen.getByRole("dialog")).getByRole("group", { name: "Level 2" })).toBeTruthy();
  });

  it("saving the picker stores the list at that level", () => {
    const [a] = pool(cleric(1));
    const { store, runId } = setup(cleric(1));
    fireEvent.click(within(row(1)).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: name(a!) }));
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(store.load(runId)!.characters[0]!.levels[0]!.prepared).toEqual([a]);
  });

  it("the take-the-list-again button appears only when the level has its own list", () => {
    const [a, b] = pool(cleric(2));
    setup(cleric(2, { 1: [a!], 2: [a!, b!] }));
    expect(within(row(1)).queryByRole("button", { name: /Take the list of level/ })).toBeNull();
    const again = within(row(2)).getByRole("button", { name: "Take the list of level 1 again" });
    fireEvent.click(again);
    expect(within(row(2)).getByText("Takes the list of level 1")).toBeTruthy();
    expect(within(row(2)).queryByRole("button", { name: /Take the list of level/ })).toBeNull();
  });

  it("an own empty list says no spell prepared (chosen)", () => {
    setup(cleric(1, { 1: [] }));
    expect(within(row(1)).getByText("No spell prepared (chosen)")).toBeTruthy();
  });

  it("a Bard level says all prepared by default", () => {
    setup(cleric(2, {}, ["Cleric", "Bard"]));
    expect(within(row(2)).getByText("All prepared by default")).toBeTruthy();
    expect(within(row(2)).getByText("Prepared spells")).toBeTruthy();
  });

  it("preparedNotOffered shows with a button that clears the list", () => {
    const [a] = pool(cleric(1));
    const c = cleric(2, { 1: [a!], 2: [a!] }, ["Cleric", "Bard"]);
    const { store, runId } = setup(c);
    const level = within(row(2));
    expect(level.getByText(/does not prepare spells/)).toBeTruthy();
    fireEvent.click(level.getByRole("button", { name: "Remove this list" }));
    expect(store.load(runId)!.characters[0]!.levels[1]!.prepared).toBeUndefined();
    expect(within(row(2)).queryByText(/does not prepare spells/)).toBeNull();
  });

  it("the count chip is good when met, todo when short, bad when over", () => {
    const spells = pool(cleric(1));
    const chip = (text: string) => within(row(1)).getByText(text);
    setup(cleric(1, { 1: spells.slice(0, 4) }));
    expect(chip("4 / 4").classList.contains("good")).toBe(true);
    cleanup();
    setup(cleric(1, { 1: spells.slice(0, 2) }));
    expect(chip("2 / 4").classList.contains("todo")).toBe(true);
    cleanup();
    setup(cleric(1, { 1: spells.slice(0, 5) }));
    expect(chip("5 / 4").classList.contains("bad")).toBe(true);
  });

  it("prepared issues are counted under their level in the sidebar summary (creation keeps its own count)", () => {
    setup(cleric(1, { 1: pool(cleric(1)).slice(0, 5) }));
    const summary = document.querySelector(".charside")!.textContent ?? "";
    expect(summary).toMatch(/Level 1: .*1 impossible choice$/);
    expect(summary).toMatch(/Creation: 1 impossible choiceLevel 1/);
  });

  it("a Barbarian level shows no prepared line", () => {
    setup(cleric(1, {}, ["Barbarian"]));
    expect(within(row(1)).queryByText("Prepared spells")).toBeNull();
    expect(within(row(1)).queryByText("All prepared by default")).toBeNull();
  });

  it("an Eldritch Knight level shows all prepared by default", () => {
    const c = cleric(3, {}, ["Fighter", "Fighter", "Fighter"]);
    c.levels[2]!.choices[subclassSlot("Fighter")] = ["EldritchKnight"];
    setup(c);
    expect(within(row(3)).getByText("All prepared by default")).toBeTruthy();
    expect(within(row(2)).queryByText("All prepared by default")).toBeNull();
  });

  it("a Wizard level says its formula is chosen among the spellbook", () => {
    const c = cleric(1, {}, ["Wizard"]);
    // The spellbook is the Wizard's own spell choice: the pool is what it holds.
    const book = resolve(c, data).levels[0]!.slots.find((slot) => slot.selector.function === "SelectSpells" && slot.selector.prepare === null)!;
    c.levels[0]!.choices[book.id] = data.rules.lists[book.selector.list]!.items.filter((spell) => (data.rules.spells[spell]?.level ?? 0) >= 1).slice(0, 6);
    setup(c);
    expect(within(row(1)).getByText("Wizard level 1 + Intelligence modifier, at least 1, chosen among the spellbook")).toBeTruthy();
  });
});
