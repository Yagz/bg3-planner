import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { skillProficiencies } from "../../../src/engine/coverage.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { featSlot, validate } from "../../../src/engine/validate.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { I18nContext, createI18n } from "../../../web/src/i18n/i18n.ts";
import NotesTab from "../../../web/src/screens/character/NotesTab.tsx";
import IssueList from "../../../web/src/screens/character/IssueList.tsx";
import { gameName } from "../../../web/src/names.ts";
import { addCharacter } from "../../../web/src/state/partyOps.ts";
import { loadTab, saveTab } from "../../../web/src/state/sessionTab.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
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

/** The whole app over a store holding `run`, on the Character screen of `id` (over `game`, the real data by default). */
function setup(run: Run, id: string, game: GameData = data) {
  const store = createStore(new MemoryBackend());
  const saved = store.save(run);
  window.history.replaceState(null, "", `#/character/${id}`);
  render(<App data={game} store={store} settingsBackend={new MemoryBackend()} sessionBackend={new MemoryBackend()} />);
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
    // One level in this list: a single group, in name order.
    expect(names).toEqual(items.map((id) => gameName(data, "en", "spell", id)).sort((a, b) => a.localeCompare(b, "en")));
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
    // Creation's ability block keeps its own style: its tiles sit in `.abil`, never in the summary tiles' `.ab6`.
    expect(dexterity.closest(".abil")).not.toBeNull();
    expect(dexterity.closest(".ab6")).toBeNull();
    const summaryTile = within(screen.getByRole("complementary")).getByRole("group", { name: "Dexterity" });
    expect(summaryTile.closest(".ab6")).not.toBeNull();
    expect(summaryTile.closest(".abil")).toBeNull();
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

  describe("spells", () => {
    /** A High Elf Bard of `levels` levels, nothing picked. */
    function bard(levels: number): Character {
      return { ...ranger(1), id: "bard", race: "Elf", subrace: "Elf_HighElf", levels: Array.from({ length: levels }, () => ({ class: "Bard", choices: {} as Record<string, Choice> })) };
    }
    const slotOf = (c: Character, n: number, id: string) => resolve(c, data).levels[n - 1]!.slots.find((s) => s.selector.id === id)!;
    const toFrench = () => fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
    const frLevel = (n: number) => screen.getByRole("group", { name: `Niveau ${n}` });
    const headings = (dialog: HTMLElement) => within(within(dialog).getByRole("group", { name: "La liste du jeu" })).getAllByRole("heading").map((h) => h.textContent);

    it("groups a spell picker by level, cantrips first and unknown levels last, names in alphabetical order; a filtered-out group disappears", () => {
      const c = bard(1);
      const spells = slotOf(c, 1, "BardSpells");
      const list = data.rules.lists[spells.selector.list]!;
      // A copy of the data whose Bard spell list also holds a cantrip and a spell the data does not know.
      const game: GameData = { ...data, rules: { ...data.rules, lists: { ...data.rules.lists, [spells.selector.list]: { ...list, items: [...list.items, "Target_ViciousMockery", "Target_NotInData"] } } } };
      setup(runWith([c]), c.id, game);
      toFrench();
      fireEvent.click(within(frLevel(1)).getByRole("button", { name: /^sorts \(4\)/ }));
      const dialog = screen.getByRole("dialog");
      expect(headings(dialog)).toEqual(["Sorts mineurs", "Niveau 1", "Autres"]);
      const inGroup = (name: string) => within(within(dialog).getByRole("group", { name })).getAllByRole("checkbox").map((box) => box.getAttribute("aria-label"));
      expect(inGroup("Sorts mineurs")).toEqual([gameName(data, "fr", "spell", "Target_ViciousMockery")]);
      expect(inGroup("Niveau 1")).toEqual(list.items.map((id) => gameName(data, "fr", "spell", id)).sort((a, b) => a.localeCompare(b, "fr")));
      expect(inGroup("Autres")).toEqual(["Target_NotInData"]);
      fireEvent.change(within(dialog).getByRole("searchbox", { name: "Filtrer la liste du jeu…" }), { target: { value: gameName(data, "fr", "spell", "Target_Sleep") } });
      expect(headings(dialog)).toEqual(["Niveau 1"]);
    });

    it("keeps Booming Blade, a cantrip the game stats give no level, among the High Elf cantrips, each said with its level and casting ability", () => {
      const c = bard(1);
      setup(runWith([c]), c.id);
      toFrench();
      const cantrips = slotOf(c, 1, "HighElfCantrip");
      fireEvent.click(within(frLevel(1)).getByRole("button", { name: /^sorts \(1\)/ }));
      const dialog = screen.getByRole("dialog");
      expect(headings(dialog)).toEqual(["Sorts mineurs"]);
      const booming = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "spell", "Target_BoomingBlade_ClassSpell") });
      expect(within(dialog).getAllByTitle("Lancé avec Intelligence").length).toBe(data.rules.lists[cantrips.selector.list]!.items.length);
      // The level tag and the ability reach screen readers through the description.
      const said = booming.getAttribute("aria-describedby")!.split(" ").map((ref) => document.getElementById(ref)!.textContent);
      expect(said[0]).toBe("mineur, lancé avec Intelligence");
    });

    it("puts a real list's spells without a level (Arcane Archer's arcane shots) in the last group", () => {
      const c: Character = { ...ranger(1), id: "archer", levels: Array.from({ length: 3 }, () => ({ class: "Fighter", choices: {} as Record<string, Choice> })) };
      c.levels[2]!.choices[subclassSlot("Fighter")] = ["ArcaneArcher"];
      const shots = resolve(c, data).levels[2]!.slots.find((s) => s.selector.function === "SelectSpells" && s.selector.count === 3)!;
      setup(runWith([c]), c.id);
      toFrench();
      fireEvent.click(within(frLevel(3)).getByRole("button", { name: /^sorts \(3\)/ }));
      const dialog = screen.getByRole("dialog");
      expect(headings(dialog)).toEqual(["Autres"]);
      expect(within(within(dialog).getByRole("group", { name: "Autres" })).getAllByRole("checkbox")).toHaveLength(data.rules.lists[shots.selector.list]!.items.length);
    });

    for (const view of ["list", "tree"] as const) {
      it(`shows picked spells as chips with their level and the ability they are cast with (${view})`, () => {
        const c = bard(4);
        c.levels[0]!.choices[slotOf(c, 1, "BardSpells").id] = ["Target_HealingWord", "Target_Sleep"];
        c.levels[0]!.choices[slotOf(c, 1, "HighElfCantrip").id] = ["Projectile_FireBolt"];
        c.levels[0]!.choices[slotOf(c, 1, "BardInstrument").id] = ["ARM_Instrument_Flute"];
        c.levels[3]!.choices[featSlot(4)] = ["RitualCaster"];
        c.levels[3]!.choices[`${featSlot(4)}/0`] = ["Target_FindFamiliar", "Target_Longstrider"];
        setup(runWith([c]), c.id);
        if (view === "tree") fireEvent.click(screen.getByRole("checkbox", { name: "Tree" }));
        toFrench();
        const chipsOf = (button: HTMLElement) => [...button.querySelectorAll(".sp")] as HTMLElement[];
        const bardSpells = chipsOf(within(frLevel(1)).getByRole("button", { name: /^sorts \(4\)/ }));
        expect(bardSpells.map((chip) => chip.querySelector(".lvl")!.textContent)).toEqual(["niv. 1", "niv. 1"]);
        expect(bardSpells[0]!.textContent).toContain(gameName(data, "fr", "spell", "Target_HealingWord"));
        const badge = bardSpells[0]!.querySelector(".cast")!;
        expect(badge.textContent).toBe(gameName(data, "fr", "ability", "Charisma"));
        expect(badge.getAttribute("title")).toBe("Lancé avec Charisme");
        expect(within(frLevel(1)).getByRole("button", { name: /^sorts \(4\)/ }).getAttribute("aria-label")).toBe(
          `sorts (4): ${gameName(data, "fr", "spell", "Target_HealingWord")}, niv. 1, lancé avec Charisme; ${gameName(data, "fr", "spell", "Target_Sleep")}, niv. 1, lancé avec Charisme`,
        );
        const [cantrip] = chipsOf(within(frLevel(1)).getByRole("button", { name: /^sorts \(1\)/ }));
        expect(cantrip!.querySelector(".lvl")!.textContent).toBe("mineur");
        expect(cantrip!.querySelector(".cast")!.getAttribute("title")).toBe("Lancé avec Intelligence");
        // Ritual Caster's selector names no ability: chips without a badge.
        const feat = chipsOf(within(frLevel(4)).getByRole("button", { name: /^sorts \(2\)/ }));
        expect(feat).toHaveLength(2);
        expect(feat.every((chip) => chip.querySelector(".cast") === null)).toBe(true);
        expect(within(frLevel(4)).getByRole("button", { name: /^sorts \(2\)/ }).getAttribute("aria-label")).not.toContain("lancé avec");
        expect(within(frLevel(1)).getByRole("button", { name: /^équipement/ }).textContent).toBe("Flûte");
      });
    }

    it("keeps a replacement as old → new inside one chip, and shows an unnamed item by its identifier", () => {
      const c = bard(1);
      c.levels[0]!.choices[slotOf(c, 1, "BardSpells").id] = ["Target_Sleep", "Target_Bane>Target_Heroism"];
      c.levels[0]!.choices[slotOf(c, 1, "BardInstrument").id] = ["ARM_Instrument_NotInData"];
      setup(runWith([c]), c.id);
      const chips = [...within(level(1)).getByRole("button", { name: /^spells \(4\)/ }).querySelectorAll(".sp")];
      expect(chips).toHaveLength(2);
      expect(chips[1]!.textContent).toContain(`${gameName(data, "en", "spell", "Target_Bane")} → ${gameName(data, "en", "spell", "Target_Heroism")}`);
      expect(within(level(1)).getByRole("button", { name: /^equipment/ }).textContent).toBe("ARM_Instrument_NotInData");
    });
  });

  describe("player origin", () => {
    const originBox = () => within(screen.getByRole("region", { name: "Creation" })).getByRole("combobox", { name: "Origin" }) as HTMLSelectElement;
    const raceButton = () => within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Race/ }) as HTMLButtonElement;

    it("offers the custom player and the origins the game offers at character creation, minus those already in the run as companions", () => {
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
      // Companions and hirelings that join in play are not offered to the player.
      expect([...values].sort()).toEqual(["", "Astarion", "DarkUrge", "Karlach", "Laezel", "Shadowheart", "Wyll"]);
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

  describe("sidebar", () => {
    /** A Lightfoot Halfling Rogue of one level with four skills and expertise in two of them. */
    function rogue(): Character {
      const c: Character = { ...ranger(1), id: "rogue", who: "Astarion", levels: [{ class: "Rogue", choices: {} }] };
      const slots = resolve(c, data).levels[0]!.slots;
      c.levels[0]!.choices[slots.find((s) => s.selector.function === "SelectSkills")!.id] = ["Acrobatics", "Deception", "Insight", "Stealth"];
      c.levels[0]!.choices[slots.find((s) => s.selector.function === "SelectSkillsExpertise")!.id] = ["Stealth", "Deception"];
      return c;
    }
    /** A High Elf Cleric 1 / Bard 11 with +2 Charisma at level 1 and Ability Improvements on Charisma at levels 5 and 9. */
    function bard(): Character {
      const c: Character = {
        ...ranger(1),
        id: "bard",
        race: "Elf",
        subrace: "Elf_HighElf",
        abilities: { Strength: 8, Dexterity: 10, Constitution: 14, Intelligence: 8, Wisdom: 14, Charisma: 14 },
        levels: [{ class: "Cleric", choices: {} }, ...Array.from({ length: 11 }, () => ({ class: "Bard", choices: {} as Record<string, Choice> }))],
      };
      const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
      c.levels[0]!.choices[bonus.id] = ["Charisma", "Wisdom"];
      for (const n of [5, 9]) {
        c.levels[n - 1]!.choices[`feat:${n}`] = ["AbilityScoreIncrease"];
        c.levels[n - 1]!.choices[`feat:${n}/0`] = ["Charisma", "Charisma"];
      }
      return c;
    }
    const sidebar = () => screen.getByRole("complementary");
    const french = () => fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
    const viewedAt = (n: number) => fireEvent.change(within(sidebar()).getByRole("combobox", { name: "Vu au niveau" }), { target: { value: String(n) } });
    const kv = (region: HTMLElement, term: string) => {
      const dt = [...region.querySelectorAll("dt")].find((el) => el.textContent === term);
      return dt?.nextElementSibling?.textContent;
    };

    it("views a 12-level character at its last level by default and at another level on request, in French: abilities, proficiency bonus, spell save DCs", () => {
      const c = bard();
      setup(runWith([c], 3), c.id);
      french();
      const region = sidebar();
      const select = within(region).getByRole("combobox", { name: "Vu au niveau" }) as HTMLSelectElement;
      expect(select.value).toBe("12");
      expect([...select.options].map((o) => o.textContent)).toEqual(["1", "2", "3 (partie)", ...Array.from({ length: 9 }, (_, i) => String(i + 4))]);
      expect(within(within(region).getByRole("group", { name: "Charisme" })).getByText("20")).toBeTruthy();
      expect(kv(region, "Bonus de maîtrise")).toBe("+4");
      expect(kv(region, "Sorts de Barde : Charisme")).toBe("DD 17");
      expect(kv(region, "Sorts de Haut-elfe : Intelligence")).toBeDefined();
      viewedAt(4);
      expect(within(within(region).getByRole("group", { name: "Charisme" })).getByText("16")).toBeTruthy();
      expect(kv(region, "Bonus de maîtrise")).toBe("+2");
      expect(kv(region, "Sorts de Barde : Charisme")).toBe("DD 13");
    });

    it("lists every skill with its value, and reaches the game description through aria-describedby", () => {
      const c = bard();
      setup(runWith([c], 3), c.id);
      french();
      const region = sidebar();
      const items = within(region).getAllByRole("listitem").filter((li) => li.classList.contains("skl"));
      expect(items).toHaveLength(Object.keys(data.skills).length);
      expect(items).toHaveLength(18);
      const names = items.map((li) => li.querySelector(".nm")!.textContent!);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "fr")));
      const persuasion = within(region).getByText(gameName(data, "fr", "skill", "Persuasion"));
      expect(persuasion.closest("li")!.querySelector("b")!.textContent).toMatch(/^[+−]\d+$/);
      const describedBy = persuasion.getAttribute("aria-describedby")!;
      expect(document.getElementById(describedBy)!.textContent).toBe("Usez de vos charmes pour manipuler et amadouer vos interlocuteurs.");
      expect(persuasion.getAttribute("tabindex")).toBe("0");
    });

    it("lists a level with a choice missing under À régler, with the creation line for issues without a level", () => {
      const c = ranger(2);
      setup(runWith([c], 2), c.id);
      french();
      const region = sidebar();
      expect(within(region).getByText("À régler")).toBeTruthy();
      expect(within(region).getByText(/^Niveau 2 : \d+ choix à faire$/)).toBeTruthy();
      expect(within(region).queryByText("Rien à régler")).toBeNull();
    });

    it("offers only the levels a character has, without the run's level when beyond them, and keeps the default on the new last level after a removal", () => {
      const c = ranger(2);
      setup(runWith([c], 5), c.id);
      const select = within(sidebar()).getByRole("combobox", { name: "Seen at level" }) as HTMLSelectElement;
      expect([...select.options].map((o) => o.textContent)).toEqual(["1", "2"]);
      cleanup();
      const d = ranger(3);
      setup(runWith([d], 1), d.id);
      expect((within(sidebar()).getByRole("combobox", { name: "Seen at level" }) as HTMLSelectElement).value).toBe("3");
      fireEvent.click(screen.getByRole("button", { name: /^Remove level 3/ }));
      const after = within(sidebar()).getByRole("combobox", { name: "Seen at level" }) as HTMLSelectElement;
      expect(after.value).toBe("2");
      expect(after.options).toHaveLength(2);
    });

    it("marks expertise, lists what the character brings next to another member, and says a character outside the active group is at camp, in French", () => {
      const r = ranger(1);
      const g = rogue();
      setup(runWith([r, g]), g.id);
      french();
      const region = sidebar();
      expect(within(region).getByText("Apport au groupe (acte 1)")).toBeTruthy();
      const stealth = within(region).getByText(gameName(data, "fr", "skill", "Stealth")).closest("li")!;
      expect(stealth.textContent).toContain("expertise");
      expect(stealth.querySelector("b")!.className).toContain("exp");
      const insight = within(region).getByText(gameName(data, "fr", "skill", "Insight")).closest("li")!;
      expect(insight.textContent).not.toContain("expertise");
      expect(insight.textContent).toContain("maîtrise");
      expect(within(region).getByText(`${gameName(data, "fr", "skill", "Deception")} · seul`)).toBeTruthy();
      cleanup();
      const camp = runWith([r, g]);
      camp.party["1"].active = [r.id];
      setup(camp, g.id);
      french();
      const away = sidebar();
      expect(within(away).getByText("Au camp à l’acte 1")).toBeTruthy();
      expect(away.querySelectorAll(".brings .pill")).toHaveLength(0);
    });
  });

  describe("levels that continue their class, and Multiclass", () => {
    /** Ranger, Rogue, Rogue, Ranger: level 2 and 4 change class, level 3 continues. */
    function mixed(): Character {
      const c = ranger(4);
      c.levels[1]!.class = "Rogue";
      c.levels[2]!.class = "Rogue";
      return c;
    }
    const classButton = (n: number) => within(level(n)).queryByRole("button", { name: /^Class:/ });
    const multiclassButton = (n: number) => within(level(n)).queryByRole("button", { name: "Multiclass" });

    for (const view of ["list", "tree"] as const) {
      it(`shows a continuing level muted with Multiclass, and a level that changes class with a multiclass pill (${view})`, () => {
        const c = mixed();
        setup(runWith([c]), c.id);
        if (view === "tree") fireEvent.click(screen.getByRole("checkbox", { name: "Tree" }));
        expect(classButton(1)).not.toBeNull();
        expect(multiclassButton(1)).toBeNull();
        for (const n of [2, 4]) {
          expect(classButton(n)).not.toBeNull();
          expect(within(level(n)).getByText("multiclass")).toBeTruthy();
          expect(multiclassButton(n)).toBeNull();
        }
        expect(classButton(3)).toBeNull();
        expect(within(level(3)).getByText(gameName(data, "en", "class", "Rogue")).className).toContain("same");
        expect(within(level(3)).queryByText("multiclass")).toBeNull();
        expect(multiclassButton(3)).not.toBeNull();
      });
    }

    it("leaves an undecided level as a dashed pick with neither pill nor Multiclass", () => {
      const c = ranger(2);
      c.levels[1]!.class = "";
      setup(runWith([c]), c.id);
      expect(classButton(2)!.textContent).toBe("to decide");
      expect(multiclassButton(2)).toBeNull();
      expect(within(level(2)).queryByText("multiclass")).toBeNull();
    });

    it("opens the class picker from Multiclass and saves the change through the impact preview", () => {
      const c = ranger(3);
      const { slot, items } = rangerSpells(c);
      c.levels[1]!.choices[slot] = [items[0]!, items[1]!];
      const { store, runId } = setup(runWith([c]), c.id);
      const versions = store.history(runId).length;
      fireEvent.click(multiclassButton(2)!);
      const pick = () => {
        const dialog = screen.getByRole("dialog");
        fireEvent.click(within(dialog).getByRole("radio", { name: gameName(data, "en", "class", "Rogue") }));
        fireEvent.click(within(dialog).getByRole("button", { name: "Validate" }));
      };
      pick();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
      expect(store.history(runId).length).toBe(versions);
      fireEvent.click(multiclassButton(2)!);
      pick();
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
      const saved = store.load(runId)!.characters[0]!;
      // Multiclass changes that level only: the later level keeps its class, as the help line says (no carry-forward).
      expect(saved.levels.map((entry) => entry.class)).toEqual(["Ranger", "Rogue", "Ranger"]);
      expect(store.history(runId).length).toBe(versions + 1);
      const levels = screen.getByRole("region", { name: "Levels" });
      expect(within(levels).getByText("A level continues the previous one's class; “Multiclass” changes the class of that level only, and a new level takes the last level's class.")).toBeTruthy();
      expect(within(levels).queryByText(/from that level/)).toBeNull();
      fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
      expect(within(screen.getByRole("region", { name: "Niveaux" })).getByText("Un niveau continue la classe du précédent ; « Multiclasser » change la classe de ce niveau seulement, et un niveau ajouté reprend la classe du dernier niveau.")).toBeTruthy();
    });

    it("adds a level that continues the last class", () => {
      const c = ranger(2);
      const { store, runId } = setup(runWith([c]), c.id);
      fireEvent.click(screen.getByRole("button", { name: "Add a level" }));
      expect(store.load(runId)!.characters[0]!.levels[2]).toEqual({ class: "Ranger", choices: {} });
      expect(multiclassButton(3)).not.toBeNull();
    });

    for (const view of ["list", "tree"] as const) {
      it(`hides Multiclass on Explorer and flags each multiclass level without removing it (${view})`, () => {
        const c = mixed();
        const run = { ...runWith([c]), difficulty: { ruleset: "DIFFICULTY_EASY", overrides: {} } };
        setup(run, c.id);
        if (view === "tree") fireEvent.click(screen.getByRole("checkbox", { name: "Tree" }));
        expect(screen.queryByRole("button", { name: "Multiclass" })).toBeNull();
        const rogue = gameName(data, "en", "class", "Rogue");
        for (const n of [2, 3]) expect(within(level(n)).getByText(`Multiclassing is disabled by the difficulty: ${rogue} cannot be added.`)).toBeTruthy();
        expect(within(level(4)).queryByText(/Multiclassing is disabled/)).toBeNull();
        // A flagged level keeps its class pick, continuing or not, so it can be set back.
        expect(classButton(2)!.textContent).toBe(rogue);
        expect(classButton(3)!.textContent).toBe(rogue);
      });
    }
  });
});

describe("IssueList", () => {
  it("names a skill already granted by its game name and words its source", () => {
    const issue = { severity: "notice", code: "skillAlreadyGranted", character: "c1", level: 1, slot: "s", params: { item: "Stealth", source: "subrace" } } as const;
    render(
      <I18nContext.Provider value={createI18n("fr")}>
        <IssueList data={data} issues={[issue]} />
      </I18nContext.Provider>,
    );
    expect(screen.getByText("La maîtrise de Discrétion est déjà accordée par la sous-race : ce choix ne rapporte rien.")).toBeTruthy();
  });
});

describe("tabs and notes", () => {
  function other(): Character {
    return { ...ranger(1), id: "other", who: "Gale" };
  }
  /** The French app on the Character screen of `id`, with a session backend that outlives a re-render. */
  function setupFr(characters: Character[], id: string, session = new MemoryBackend()) {
    const store = createStore(new MemoryBackend());
    const saved = store.save(runWith(characters));
    const settings = new MemoryBackend();
    settings.setItem("bg3p:settings", JSON.stringify({ lang: "fr" }));
    window.history.replaceState(null, "", `#/character/${id}`);
    const mount = () => render(<App data={data} store={store} settingsBackend={settings} sessionBackend={session} />);
    mount();
    return { store, runId: saved.id, session, mount };
  }
  const notesOf = (store: ReturnType<typeof createStore>, runId: string, id: string) => store.load(runId)!.characters.find((c) => c.id === id)!.notes;
  const openNotes = () => fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
  const field = () => screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
  const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

  it("offers Fiche and Notes, Fiche selected first, and Notes shows the stored notes", () => {
    const c = { ...ranger(1), notes: "Prendre Guérison" };
    setupFr([c], c.id);
    const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Fiche", "Notes"]);
    expect(screen.getByRole("tab", { name: "Fiche" }).getAttribute("aria-selected")).toBe("true");
    expect(document.getElementById("charpanel-notes")!.hasAttribute("hidden")).toBe(true);
    openNotes();
    expect(document.getElementById("charpanel-sheet")!.hasAttribute("hidden")).toBe(true);
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    expect(field().value).toBe("Prendre Guérison");
  });

  it("moves between tabs with the arrow keys, Home and End, wrapping, and focuses the target", () => {
    const c = ranger(1);
    setupFr([c], c.id);
    const sheet = screen.getByRole("tab", { name: "Fiche" });
    sheet.focus();
    fireEvent.keyDown(sheet, { key: "ArrowRight" });
    const notes = screen.getByRole("tab", { name: "Notes" });
    expect(notes.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "ArrowRight" });
    expect(document.activeElement).toBe(sheet);
    fireEvent.keyDown(sheet, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(notes);
    fireEvent.keyDown(notes, { key: "Home" });
    expect(document.activeElement).toBe(sheet);
    fireEvent.keyDown(sheet, { key: "End" });
    expect(document.activeElement).toBe(notes);
    expect(notes.getAttribute("aria-selected")).toBe("true");
  });

  it("tries a refused notes save again on the next blur", () => {
    const onSave = vi.fn().mockReturnValueOnce(false);
    render(
      <I18nContext.Provider value={createI18n("fr")}>
        <NotesTab notes="" onSave={onSave} />
      </I18nContext.Provider>,
    );
    const box = screen.getByRole("textbox", { name: "Notes" });
    fireEvent.change(box, { target: { value: "texte" } });
    fireEvent.blur(box);
    fireEvent.blur(box);
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith("texte");
  });

  it("saves one version on blur holding the typed text", () => {
    const c = ranger(1);
    const { store, runId } = setupFr([c], c.id);
    const before = store.history(runId).length;
    openNotes();
    type("Ligne 1\nLigne 2");
    expect(store.history(runId).length).toBe(before);
    fireEvent.blur(field());
    expect(store.history(runId).length).toBe(before + 1);
    expect(notesOf(store, runId, c.id)).toBe("Ligne 1\nLigne 2");
  });

  it("makes no version on a typing pause, and exactly one on blur", () => {
    vi.useFakeTimers();
    const c = ranger(1);
    const { store, runId } = setupFr([c], c.id);
    const before = store.history(runId).length;
    openNotes();
    type("a");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    type("ab");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(store.history(runId).length).toBe(before);
    fireEvent.blur(field());
    expect(store.history(runId).length).toBe(before + 1);
    expect(notesOf(store, runId, c.id)).toBe("ab");
  });

  it("saves to the first character when switching character without a blur", () => {
    const a = ranger(1);
    const b = other();
    const { store, runId } = setupFr([a, b], a.id);
    const before = store.history(runId).length;
    openNotes();
    type("pour le premier");
    fireEvent.click(screen.getByRole("button", { name: gameName(data, "fr", "origin", "Gale") }));
    expect(notesOf(store, runId, a.id)).toBe("pour le premier");
    expect(notesOf(store, runId, b.id)).toBe("");
    expect(store.history(runId).length).toBe(before + 1);
  });

  it("saves the draft on pagehide, once", () => {
    const c = ranger(1);
    const { store, runId } = setupFr([c], c.id);
    const before = store.history(runId).length;
    openNotes();
    type("avant la fermeture");
    window.dispatchEvent(new Event("pagehide"));
    expect(notesOf(store, runId, c.id)).toBe("avant la fermeture");
    fireEvent.blur(field());
    expect(store.history(runId).length).toBe(before + 1);
  });

  it("remembers the tab per character for the session", () => {
    const a = ranger(1);
    const b = other();
    const { session, mount } = setupFr([a, b], a.id);
    openNotes();
    cleanup();
    mount();
    expect(screen.getByRole("tab", { name: "Notes" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: gameName(data, "fr", "origin", "Gale") }));
    expect(screen.getByRole("tab", { name: "Fiche" }).getAttribute("aria-selected")).toBe("true");
    expect(loadTab(session, a.id)).toBe("notes");
    expect(loadTab(session, b.id)).toBe("sheet");
  });
});

describe("session tab storage", () => {
  it("defaults to the sheet, round-trips and ignores unknown values", () => {
    const backend = new MemoryBackend();
    expect(loadTab(backend, "x")).toBe("sheet");
    saveTab(backend, "x", "notes");
    expect(loadTab(backend, "x")).toBe("notes");
    expect(loadTab(backend, "y")).toBe("sheet");
    backend.setItem("bg3p:tab:x", "equipment");
    expect(loadTab(backend, "x")).toBe("sheet");
    expect(loadTab(null, "x")).toBe("sheet");
  });

  it("never throws on an unreadable or full storage", () => {
    const backend = new MemoryBackend();
    backend.failReads = "SecurityError";
    backend.failWrites = "QuotaExceededError";
    expect(loadTab(backend, "x")).toBe("sheet");
    expect(() => saveTab(backend, "x", "notes")).not.toThrow();
  });
});
