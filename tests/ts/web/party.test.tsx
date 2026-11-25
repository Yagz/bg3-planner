import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import type { Lang } from "../../../web/src/i18n/i18n.ts";
import { addCharacter } from "../../../web/src/state/partyOps.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

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

/** The whole app over a store holding `run`, on the Party screen; the language is switched through the interface. */
function setup(run: Run, lang: Lang = "en", store = createStore(new MemoryBackend())) {
  const saved = store.save(run);
  window.history.replaceState(null, "", "#/party");
  render(<App data={data} store={store} settingsBackend={new MemoryBackend()} />);
  if (lang === "fr") fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
  return { store, id: saved.id };
}

function runWith(character: Character, level: number): Run {
  const run = emptyRun("r");
  run.characters = [character];
  run.party["1"].active = [character.id];
  run.progress = { level, act: 1 };
  return run;
}

describe("Party screen", () => {
  it("lays its frames out inside one stack, whatever the screen nests", () => {
    setup(runWith(ranger(4), 3));
    const frames = [...document.querySelectorAll(".frame")];
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame.parentElement?.classList.contains("stack")).toBe(true);
  });

  it("tells a Ranger at level 3 what level 4 asks and how many choices are undecided by then", () => {
    setup(runWith(ranger(4), 3));
    const card = screen.getByRole("article");
    expect(within(card).getByText(/Ranger 3/)).toBeTruthy();
    expect(within(card).getByText(/Gloom Stalker/)).toBeTruthy();
    expect(within(card).getByText(/Level 4: Ranger/)).toBeTruthy();
    // Level 4 grants a feat; levels 1 to 4 still hold their other open choices.
    expect(within(card).getByText("feat")).toBeTruthy();
    const open = within(card).getByText(/(\d+) undecided by then/);
    const count = Number(/(\d+) undecided/.exec(open.textContent!)![1]);
    expect(count).toBeGreaterThan(1);
    fireEvent.click(within(card).getByRole("button", { name: "Open the build" }));
    expect(window.location.hash).toBe("#/character/ranger");
  });

  it("names the subclass choice a next level asks", () => {
    const c = ranger(3);
    delete c.levels[2]!.choices[subclassSlot("Ranger")];
    setup(runWith(c, 2));
    expect(within(screen.getByRole("article")).getByText(/Level 3: Ranger/).closest("p")!.textContent).toContain("subclass");
  });

  it("says the top is reached at level 12", () => {
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

  it("counts a skill as covered when a member listed later is proficient, even below an unproficient member's value", () => {
    // Lae'zel (Soldier, no Medicine) with Wisdom 17 beats the Haunted One Ranger's Medicine total with Wisdom 10.
    let run = addCharacter(runWith({ ...ranger(3), abilities: { ...ranger(3).abilities, Wisdom: 10 } }, 3), data, "Laezel");
    const laezel = { ...run.characters[1]!, abilities: { ...run.characters[1]!.abilities, Wisdom: 17 } };
    run = { ...run, characters: [run.characters[0]!, laezel] };
    run.party["1"].active = [laezel.id, "ranger"];
    setup(run);
    const summary = screen.getByRole("region", { name: "Skill coverage" });
    const uncovered = within(summary).getByText(/No proficiency in the party/).closest("p")!;
    expect(uncovered.textContent).not.toContain("Medicine");
    expect(uncovered.textContent).toContain("Arcana");
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
    expect(screen.getByRole("heading", { name: "Groupe" })).toBeTruthy();
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

  it("changes the party size; a smaller size keeps every active member and flags the over-full act", () => {
    let run = addCharacter(runWith(ranger(3), 3), data, "Gale");
    run = addCharacter(run, data, "Karlach");
    run.party["1"].active = run.characters.map((c) => c.id);
    const { store, id } = setup(run);
    const size = screen.getByRole("spinbutton", { name: "Party size" }) as HTMLInputElement;
    expect(size.value).toBe("4");
    expect(size.min).toBe("1");
    expect(size.max).toBe("8");
    expect(screen.queryByText(/more than the party size/)).toBeNull();
    fireEvent.change(size, { target: { value: "2" } });
    expect(store.load(id)!.partySize).toBe(2);
    expect(store.load(id)!.party["1"].active).toHaveLength(3);
    expect(screen.getByText("Act 1: 3 active members, more than the party size (2).")).toBeTruthy();
    // Unchecking a member of the over-full act works; checking one back in does not.
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(store.load(id)!.party["1"].active).toHaveLength(2);
    expect(screen.getByRole("checkbox", { name: "Gale" })).toHaveProperty("disabled", true);
    expect(screen.queryByText(/more than the party size/)).toBeNull();
    fireEvent.change(size, { target: { value: "9" } });
    expect(store.load(id)!.partySize).toBe(2);
  });

  it("never offers the player's own origin as a companion", () => {
    setup({ ...runWith(ranger(3), 3), origin: "Gale" });
    const select = screen.getByRole("combobox", { name: "Add a character" });
    expect(within(select).queryByRole("option", { name: "Gale" })).toBeNull();
    expect(within(select).getByRole("option", { name: "Karlach" })).toBeTruthy();
  });

  it("adds a companion from the origins and never one already present", () => {
    const { store, id } = setup(runWith(ranger(3), 3));
    const select = screen.getByRole("combobox", { name: "Add a character" });
    expect(within(select).queryByRole("option", { name: "Generic" })).toBeNull();
    expect(within(select).getByRole("option", { name: "Gale" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "Shadowheart" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(store.load(id)!.characters.map((c) => c.who)).toEqual(["player", "Shadowheart"]);
    expect(within(screen.getByRole("combobox", { name: "Add a character" })).queryByRole("option", { name: "Shadowheart" })).toBeNull();
  });

  it("keeps a rename made in the run bar when the party is edited afterwards", () => {
    const { store, id } = setup(runWith(ranger(3), 3));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(store.load(id)!.name).toBe("Renamed");
    expect(store.load(id)!.progress.level).toBe(5);
  });

  it("shows the error banner when an operation throws, and when the store refuses the save", () => {
    let run = runWith(ranger(3), 3);
    run = addCharacter(run, data, "Gale");
    run.party["1"].active = ["ghost", "ranger"];
    const { store } = setup(run);
    fireEvent.click(screen.getByRole("checkbox", { name: "Gale" }));
    expect(screen.getByRole("alert").textContent).toBe("The change could not be saved: Unknown character: ghost");
    expect(store.history(run.id).length).toBe(1);

    vi.spyOn(store, "save").mockImplementation(() => {
      throw new Error("disk full");
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Level reached" }), { target: { value: "5" } });
    expect(screen.getByRole("alert").textContent).toBe("The change could not be saved: disk full");
  });
});
