import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { gameName } from "../../../web/src/names.ts";
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
});

/** A Lightfoot Halfling Ranger of `levels` levels with its level-1 skills picked and nothing else. */
function ranger(levels: number): Character {
  const c: Character = {
    id: "ranger",
    who: "player",
    race: "Halfling",
    subrace: "Halfling_Lightfoot",
    background: Object.keys(data.rules.backgrounds)[0]!,
    abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
    levels: Array.from({ length: levels }, () => ({ class: "Ranger", choices: {} as Record<string, Choice> })),
    items: [],
    notes: "",
  };
  const skills = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectSkills")!;
  c.levels[0]!.choices[skills.id] = ["Stealth", "Perception", "Survival"];
  return c;
}

/** The level-2 `SelectSpells` slot of a Ranger and its list's items, read from the real data. */
function rangerSpells(c: Character) {
  const slot = resolve(c, data).levels[1]!.slots.find((s) => s.selector.function === "SelectSpells")!;
  return { slot: slot.id, items: data.rules.lists[slot.selector.list]!.items };
}

function runWith(characters: Character[], level = 1): Run {
  const run = emptyRun("r");
  run.characters = characters;
  run.party["1"].active = characters.map((c) => c.id);
  run.progress = { level, act: 1 };
  return run;
}

/** The whole app over a store holding `run`, on the Character screen of `id`. */
function setup(run: Run, id: string) {
  const store = createStore(new MemoryBackend());
  const saved = store.save(run);
  window.history.replaceState(null, "", `#/character/${id}`);
  render(<App data={data} store={store} settingsBackend={new MemoryBackend()} />);
  return { store, runId: saved.id };
}

const level = (n: number) => screen.getByRole("group", { name: `Level ${n}` });
const openSpells = () => fireEvent.click(within(level(2)).getByRole("button", { name: /^spells/ }));

describe("Character screen", () => {
  it("lists the real spell list of the Ranger's level-2 slot and enables Validate at 2 / 2 only", () => {
    const c = ranger(2);
    const { slot, items } = rangerSpells(c);
    const { store, runId } = setup(runWith([c]), c.id);
    openSpells();
    const dialog = screen.getByRole("dialog");
    const names = within(within(dialog).getByRole("group", { name: "The game's list" }))
      .getAllByRole("checkbox")
      .map((box) => box.getAttribute("aria-label"));
    expect(names).toEqual(items.map((id) => gameName(data, "en", "spell", id)));
    const validate = within(dialog).getByRole("button", { name: "Validate" });
    expect(validate).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", items[0]!) }));
    expect(within(dialog).getByText("1 / 2")).toBeTruthy();
    expect(validate).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", items[1]!) }));
    expect(within(dialog).getByText("2 / 2")).toBeTruthy();
    expect(validate).toHaveProperty("disabled", false);
    fireEvent.click(validate);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.load(runId)!.characters[0]!.levels[1]!.choices[slot]).toEqual([items[0], items[1]]);
    expect(within(level(2)).getByRole("button", { name: /^spells/ }).textContent).toContain(gameName(data, "en", "spell", items[0]!));
  });

  it("saves a value outside the game data as written and shows the engine's notice at its slot", () => {
    const c = ranger(2);
    const { slot } = rangerSpells(c);
    const { store, runId } = setup(runWith([c]), c.id);
    openSpells();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Outside the game data" }));
    const validate = within(dialog).getByRole("button", { name: "Validate" });
    expect(validate).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Value outside the game data" }), { target: { value: "Mod spell" } });
    fireEvent.click(validate);
    expect(store.load(runId)!.characters[0]!.levels[1]!.choices[slot]).toEqual({ offData: "Mod spell" });
    expect(within(level(2)).getByRole("button", { name: /^spells/ }).textContent).toContain("Mod spell");
    expect(within(level(2)).getByText("Value outside the game data (a mod?), kept as written.")).toBeTruthy();
  });

  it("keeps the selection when the language changes while the picker is open", () => {
    const c = ranger(2);
    const { items } = rangerSpells(c);
    setup(runWith([c]), c.id);
    openSpells();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("checkbox", { name: gameName(data, "en", "spell", items[2]!) }));
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "spell", items[2]!) })).toHaveProperty("checked", true);
    expect(within(dialog).getByText("1 / 2")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Valider" })).toBeTruthy();
  });

  it("closes the picker on Escape and on Cancel without changing the run", () => {
    const c = ranger(2);
    const { items } = rangerSpells(c);
    const { store, runId } = setup(runWith([c]), c.id);
    const versions = store.history(runId).length;
    openSpells();
    const pick = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", items[0]!) }));
    pick(screen.getByRole("dialog"));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    openSpells();
    expect(within(screen.getByRole("dialog")).getByText("0 / 2")).toBeTruthy();
    pick(screen.getByRole("dialog"));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.history(runId).length).toBe(versions);
    expect(within(level(2)).getByRole("button", { name: /^spells/ }).textContent).toBe("to decide");
  });

  it("shows the level-1 ability bonus, the point-buy counter, and played levels apart from upcoming ones", () => {
    const c = ranger(3);
    const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
    c.levels[0]!.choices[bonus.id] = ["Dexterity", "Wisdom"];
    c.levels[2]!.choices[subclassSlot("Ranger")] = ["GloomStalker"];
    setup(runWith([c], 2), c.id);
    const creation = screen.getByRole("region", { name: "Creation" });
    expect(within(creation).getByText("27 / 27")).toBeTruthy();
    const dexterity = within(creation).getByRole("group", { name: "Dexterity" });
    expect(within(dexterity).getByText("17")).toBeTruthy();
    expect(within(dexterity).getByText("+2")).toBeTruthy();
    expect(level(1).className).toContain("played");
    expect(level(3).className).not.toContain("played");
    expect(screen.getByText(/Upcoming/)).toBeTruthy();
    expect(within(level(3)).getByRole("button", { name: /^subclass/ }).textContent).toBe("Gloom Stalker");
  });

  it("disables the race, subrace and background of a companion whose origin locks them", () => {
    const run = addCharacter(emptyRun("r"), data, "Shadowheart");
    const shadowheart = run.characters[0]!;
    setup(run, shadowheart.id);
    const creation = screen.getByRole("region", { name: "Creation" });
    for (const field of ["Race", "Subrace", "Background"]) {
      expect(within(creation).getByRole("button", { name: new RegExp(`^${field}`) })).toHaveProperty("disabled", true);
    }
    expect(within(creation).getByRole("button", { name: /^Race/ }).textContent).toBe(gameName(data, "en", "race", "HalfElf"));
  });

  it("lets the player pick a race from the game's races, a first pick applied directly", () => {
    const run = addCharacter(emptyRun("r"), data, "player");
    const player = run.characters[0]!;
    const { store, runId } = setup(run, player.id);
    const race = within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Race/ });
    expect(race.textContent).toBe("to decide");
    fireEvent.click(race);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: gameName(data, "en", "race", "Halfling") }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Validate" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.load(runId)!.characters[0]!.race).toBe("Halfling");
  });

  it("gives the level-1 bonuses in the order picked, +2 then +1", () => {
    const c = ranger(1);
    const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
    const { store, runId } = setup(runWith([c]), c.id);
    fireEvent.click(within(level(1)).getByRole("button", { name: /^ability scores/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "+2" }), { target: { value: "Wisdom" } });
    const validate = within(dialog).getByRole("button", { name: "Validate" });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "+1" }), { target: { value: "Wisdom" } });
    expect(validate).toHaveProperty("disabled", true);
    fireEvent.change(within(dialog).getByRole("combobox", { name: "+1" }), { target: { value: "Dexterity" } });
    fireEvent.click(validate);
    expect(store.load(runId)!.characters[0]!.levels[0]!.choices[bonus.id]).toEqual(["Wisdom", "Dexterity"]);
    expect(within(within(screen.getByRole("region", { name: "Creation" })).getByRole("group", { name: "Wisdom" })).getByText("17")).toBeTruthy();
  });

  it("offers to replace a spell known from an earlier level, stored as old>new", () => {
    const c = ranger(3);
    const { slot, items } = rangerSpells(c);
    c.levels[1]!.choices[slot] = [items[0]!, items[1]!];
    const level3 = resolve(c, data).levels[2]!.slots.find((s) => s.selector.function === "SelectSpells")!;
    const { store, runId } = setup(runWith([c]), c.id);
    fireEvent.click(within(level(3)).getByRole("button", { name: /^spells/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", items[2]!) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add a replacement" }));
    const validate = within(dialog).getByRole("button", { name: "Validate" });
    expect(validate).toHaveProperty("disabled", true);
    const old = within(dialog).getByRole("combobox", { name: "Replace" });
    expect(within(old).getAllByRole("option").map((o) => o.getAttribute("value"))).toEqual(["", items[0], items[1]]);
    fireEvent.change(old, { target: { value: items[0] } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "with" }), { target: { value: items[3] } });
    fireEvent.click(validate);
    expect(store.load(runId)!.characters[0]!.levels[2]!.choices[level3.id]).toEqual([items[2], `${items[0]}>${items[3]}`]);
  });

  it("shows a stored replacement on a slot that allows none, so it can be removed", () => {
    const c = ranger(2);
    const { slot, items } = rangerSpells(c);
    expect(resolve(c, data).levels[1]!.slots.find((s) => s.id === slot)!.selector).toMatchObject({ swaps: 0 });
    c.levels[1]!.choices[slot] = [items[0]!, items[1]!, `${items[2]}>${items[3]}`];
    const { store, runId } = setup(runWith([c]), c.id);
    openSpells();
    const dialog = screen.getByRole("dialog");
    const validate = within(dialog).getByRole("button", { name: "Validate" });
    expect(validate).toHaveProperty("disabled", true);
    const swaps = within(dialog).getByRole("group", { name: "Replacements (1 / 0)" });
    expect(within(swaps).getByRole("combobox", { name: "Replace" })).toHaveProperty("value", items[2]);
    expect(within(swaps).getByRole("button", { name: "Add a replacement" })).toHaveProperty("disabled", true);
    fireEvent.click(within(swaps).getByRole("button", { name: "Remove" }));
    expect(validate).toHaveProperty("disabled", false);
    fireEvent.click(validate);
    expect(store.load(runId)!.characters[0]!.levels[1]!.choices[slot]).toEqual([items[0], items[1]]);
  });

  describe("player origin", () => {
    const originBox = () => within(screen.getByRole("region", { name: "Creation" })).getByRole("combobox", { name: "Origin" }) as HTMLSelectElement;
    const raceButton = () => within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Race/ }) as HTMLButtonElement;

    it("offers the custom player and the origins with a class, minus those already in the run as companions", () => {
      const run = addCharacter(addCharacter(emptyRun("r"), data, "player"), data, "Gale");
      setup(run, run.characters[0]!.id);
      const values = within(originBox()).getAllByRole("option").map((option) => option.getAttribute("value"));
      expect(values[0]).toBe("");
      expect(originBox().value).toBe("");
      // The custom player is named by the game's own label for the Generic origin.
      expect(originBox().selectedOptions[0]!.textContent).toBe(gameName(data, "en", "origin", "Generic"));
      expect(values).toContain("DarkUrge");
      expect(values).toContain("Astarion");
      expect(values).not.toContain("Generic");
      expect(values).not.toContain("Gale");
      cleanup();
      setup(run, run.characters[1]!.id);
      expect(within(screen.getByRole("region", { name: "Creation" })).queryByRole("combobox", { name: "Origin" })).toBeNull();
    });

    it("fills and locks the origin's race, subrace and background on an undecided player, then frees them on custom", () => {
      const run = addCharacter(emptyRun("r"), data, "player");
      const { store, runId } = setup(run, run.characters[0]!.id);
      const gale = data.rules.origins["Gale"]!;
      fireEvent.change(originBox(), { target: { value: "Gale" } });
      expect(screen.queryByRole("dialog")).toBeNull();
      const saved = store.load(runId)!;
      expect(saved.origin).toBe("Gale");
      expect(saved.characters[0]).toMatchObject({ race: gale.race, subrace: gale.subrace, background: gale.background });
      expect(saved.characters[0]!.levels).toEqual(run.characters[0]!.levels);
      expect(saved.characters[0]!.abilities).toEqual(run.characters[0]!.abilities);
      expect(raceButton().disabled).toBe(true);
      expect(screen.getByText("race, subrace and background set by the character")).toBeTruthy();

      fireEvent.change(originBox(), { target: { value: "" } });
      expect(store.load(runId)!.origin).toBe("");
      expect(store.load(runId)!.characters[0]).toMatchObject({ race: gale.race, subrace: gale.subrace, background: gale.background });
      expect(raceButton().disabled).toBe(false);
    });

    it("goes through the impact preview when the origin replaces identity already chosen; Cancel changes nothing", () => {
      const c = ranger(2);
      const { store, runId } = setup(runWith([c]), c.id);
      const versions = store.history(runId).length;
      fireEvent.change(originBox(), { target: { value: "Astarion" } });
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(store.history(runId).length).toBe(versions);
      expect(store.load(runId)!.origin).toBe("");
      expect(originBox().value).toBe("");

      fireEvent.change(originBox(), { target: { value: "Astarion" } });
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
      const astarion = data.rules.origins["Astarion"]!;
      const saved = store.load(runId)!;
      expect(saved.origin).toBe("Astarion");
      expect(saved.characters[0]).toMatchObject({ race: astarion.race, subrace: astarion.subrace, background: astarion.background });
      expect(store.history(runId).length).toBe(versions + 1);
    });

    it("takes an origin that locks nothing without touching the character", () => {
      const c = ranger(2);
      const { store, runId } = setup(runWith([c]), c.id);
      fireEvent.change(originBox(), { target: { value: "DarkUrge" } });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(store.load(runId)!.origin).toBe("DarkUrge");
      expect(store.load(runId)!.characters[0]).toEqual(c);
    });
  });

  it("offers a hidden background only to its origin: Haunted One to a Dark Urge player", () => {
    const hauntedOne = data.rules.origins["DarkUrge"]!.background!;
    expect(data.rules.backgrounds[hauntedOne]!.origin).toBe(true);
    const openBackgrounds = (run: Run) => {
      setup(run, run.characters[0]!.id);
      fireEvent.click(within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Background/ }));
      return within(screen.getByRole("dialog")).queryByRole("radio", { name: gameName(data, "en", "background", hauntedOne) });
    };
    const darkUrge = addCharacter({ ...emptyRun("r"), origin: "DarkUrge" }, data, "player");
    expect(openBackgrounds(darkUrge)).not.toBeNull();
    cleanup();
    expect(openBackgrounds(addCharacter(emptyRun("r"), data, "player"))).toBeNull();
  });
});
