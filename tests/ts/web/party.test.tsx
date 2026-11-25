import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import { I18nContext, createI18n } from "../../../web/src/i18n/i18n.ts";
import type { Lang } from "../../../web/src/i18n/i18n.ts";
import Party from "../../../web/src/screens/Party.tsx";
import { addCharacter } from "../../../web/src/state/partyOps.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});
afterEach(cleanup);

/** A Haunted One Lightfoot Halfling Ranger of `levels` levels, its skills and its level-3 subclass chosen, nothing else. */
function ranger(levels: number): Character {
  const hauntedOne = Object.keys(data.rules.backgrounds).find((k) => data.rules.backgrounds[k]!.passives.includes("Background_HauntedOne"))!;
  const c: Character = {
    id: "ranger",
    who: "player",
    race: "Halfling",
    subrace: "Halfling_Lightfoot",
    background: hauntedOne,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: Array.from({ length: levels }, () => ({ class: "Ranger", choices: {} })),
    items: [],
    notes: "",
  };
  const first = resolve(c, data).levels[0]!;
  const skills = first.slots.find((s) => s.selector.function === "SelectSkills")!;
  (c.levels[0]!.choices as Record<string, Choice>)[skills.id] = ["Stealth", "Perception", "Survival"];
  c.levels[2]!.choices[subclassSlot("Ranger")] = ["GloomStalker"];
  return c;
}

function setup(run: Run, lang: Lang = "en") {
  const store = createStore(new MemoryBackend());
  const saved = store.save(run);
  const onOpen = vi.fn();
  render(
    <I18nContext.Provider value={createI18n(lang)}>
      <Party data={data} store={store} runId={saved.id} onChanged={vi.fn()} onOpenCharacter={onOpen} />
    </I18nContext.Provider>,
  );
  return { store, id: saved.id, onOpen };
}

function runWith(character: Character, level: number): Run {
  const run = emptyRun("r");
  run.characters = [character];
  run.party["1"].active = [character.id];
  run.progress = { level, act: 1 };
  return run;
}

describe("Party screen", () => {
  it("tells a Ranger at level 3 what level 4 asks and how many choices are undecided by then", () => {
    const { onOpen } = setup(runWith(ranger(4), 3));
    const card = screen.getByRole("article");
    expect(within(card).getByText(/Ranger 3/)).toBeTruthy();
    expect(within(card).getByText(/Gloom Stalker/)).toBeTruthy();
    expect(within(card).getByText(/Level 4: Ranger/)).toBeTruthy();
    // Level 4 grants a feat; levels 1 to 4 still hold their other open choices.
    expect(within(card).getByText(/1 choice to make/)).toBeTruthy();
    const open = within(card).getByText(/(\d+) undecided by then/);
    const count = Number(/(\d+) undecided/.exec(open.textContent!)![1]);
    expect(count).toBeGreaterThan(1);
    fireEvent.click(within(card).getByRole("button", { name: "Open the build" }));
    expect(onOpen).toHaveBeenCalledWith("ranger");
  });

  it("says there is nothing to choose when the next level asks nothing, and when the top is reached", () => {
    setup(runWith(ranger(12), 12));
    expect(screen.getByText("Top level reached.")).toBeTruthy();
  });

  it("lists a skill nobody in the active party is proficient in", () => {
    setup(runWith(ranger(3), 3));
    const summary = screen.getByRole("region", { name: "Skill coverage" });
    const uncovered = within(summary).getByText(/No proficiency in the party/).closest("p")!;
    expect(uncovered.textContent).toContain("Arcana");
    expect(uncovered.textContent).not.toContain("Stealth");
    expect(within(summary).getByText(/Best/).closest("p")!.textContent).toContain("Stealth");
  });

  it("shows the names in French and lists members outside the active party with their status", () => {
    let run = runWith(ranger(3), 3);
    run = addCharacter(run, data, "Gale");
    const gale = run.characters[1]!;
    run.party["1"].status[gale.id] = "alternative";
    setup(run, "fr");
    expect(screen.getByText(/Pisteur des ténèbres/)).toBeTruthy();
    const others = screen.getByRole("region", { name: "Hors du groupe actif" });
    expect(within(others).getByText("Gayle")).toBeTruthy();
    expect(within(others).getByText("alternative")).toBeTruthy();
  });

  it("saves the progress and the active party through the store", () => {
    let run = runWith(ranger(3), 3);
    run = addCharacter(run, data, "Gale");
    const { store, id } = setup(run);
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(store.load(id)!.progress).toEqual({ level: 5, act: 1 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(store.load(id)!.party["1"].active).toEqual(["ranger", store.load(id)!.characters[1]!.id]);
    fireEvent.click(screen.getByRole("tab", { name: "Act 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Take the previous act's party" }));
    expect(store.load(id)!.party["2"].active).toHaveLength(2);
    expect(store.history(id).length).toBeGreaterThan(3);
  });

  it("adds a companion from the origins and never one already present", () => {
    const { store, id } = setup(runWith(ranger(3), 3));
    const select = screen.getByRole("combobox", { name: "Add a character" });
    expect(within(select).queryByRole("option", { name: "Generic" })).toBeNull();
    fireEvent.change(select, { target: { value: "Shadowheart" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(store.load(id)!.characters.map((c) => c.who)).toEqual(["player", "Shadowheart"]);
    expect(within(screen.getByRole("combobox", { name: "Add a character" })).queryByRole("option", { name: "Shadowheart" })).toBeNull();
  });
});
