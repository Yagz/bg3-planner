import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { act } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { characterSkillValues, skillProficiencies } from "../../../src/engine/coverage.ts";
import { rulesetEffects } from "../../../src/engine/difficulty.ts";
import { backgroundTraits } from "../../../src/engine/traits.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { featSlot, validate } from "../../../src/engine/validate.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { I18nContext, createI18n } from "../../../web/src/i18n/i18n.ts";
import Abilities from "../../../web/src/screens/character/Abilities.tsx";
import NotesTab from "../../../web/src/screens/character/NotesTab.tsx";
import IssueList from "../../../web/src/screens/character/IssueList.tsx";
import { gameDescription, gameName } from "../../../web/src/names.ts";
import { signed } from "../../../web/src/screens/Coverage.tsx";
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

const abilitiesFrame = () => screen.getByRole("region", { name: "Abilities" });
const rowOf = (frame: HTMLElement, ability: string) => within(frame).getByRole("cell", { name: ability }).closest("tr") as HTMLElement;
const level = (n: number) => screen.getByRole("group", { name: `Level ${n}` });
/** What screen readers hear for an entry: the texts its aria-describedby points to. */
const said = (box: HTMLElement) => (box.getAttribute("aria-describedby") ?? "").split(" ").filter((ref) => ref !== "").map((ref) => document.getElementById(ref)!.textContent);
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

  it("shows the abilities table: base, the level-1 +2 and +1, the total and the modifier, the point-buy counter, and played levels apart from upcoming ones", () => {
    const c = ranger(3);
    const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
    c.levels[0]!.choices[bonus.id] = ["Dexterity", "Wisdom"];
    c.levels[2]!.choices[subclassSlot("Ranger")] = ["GloomStalker"];
    setup(runWith([c], 2), c.id);
    const frame = abilitiesFrame();
    expect(within(frame).getByText("27 / 27 points")).toBeTruthy();
    expect(within(frame).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Ability", "Base", "+2", "+1", "Level 1 total", "Mod."]);
    const dexterity = rowOf(frame, "Dexterity");
    expect([...dexterity.querySelectorAll("td")].map((td) => td.textContent)).toEqual(["Dexterity", "−15+", "", "", "17", "+3"]);
    expect(within(dexterity).getByRole("radio", { name: "+2 Dexterity" })).toHaveProperty("checked", true);
    expect(within(rowOf(frame, "Wisdom")).getByRole("radio", { name: "+1 Wisdom" })).toHaveProperty("checked", true);
    expect(within(rowOf(frame, "Strength")).getAllByRole("cell").at(-1)!.textContent).toBe("-1");
    // The table keeps its own class: never the ability tiles' `.ab6` of the sidebar.
    expect(frame.querySelector(".abiltable")).not.toBeNull();
    expect(frame.closest(".ab6")).toBeNull();
    expect(within(screen.getByRole("complementary")).getByRole("group", { name: "Dexterity" }).closest(".ab6")).not.toBeNull();
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
      expect(within(creation).getByRole("button", { name: new RegExp(`^Change — ${field}`) })).toHaveProperty("disabled", true);
    }
    expect(within(within(creation).getByRole("button", { name: /^Change — Race/ }).closest(".idcard") as HTMLElement).getByText(gameName(data, "en", "race", "HalfElf"))).toBeTruthy();
  });

  it("lets the player pick a race from the game's races, a first pick applied directly", () => {
    const run = addCharacter(emptyRun("r"), data, "player");
    const player = run.characters[0]!;
    const { store, runId } = setup(run, player.id);
    const race = within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Change — Race/ });
    expect(within(race.closest(".idcard") as HTMLElement).getByText("to decide")).toBeTruthy();
    fireEvent.click(race);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: gameName(data, "en", "race", "Halfling") }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Validate" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.load(runId)!.characters[0]!.race).toBe("Halfling");
  });

  describe("abilities table", () => {
    const radio = (ability: string, bonus: string) => within(rowOf(abilitiesFrame(), ability)).getByRole("radio", { name: `${bonus} ${ability}` });

    it("gives the level-1 bonuses in the order picked, +2 then +1, saved once both are chosen and with no picker", () => {
      const c = ranger(1);
      const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
      const { store, runId } = setup(runWith([c]), c.id);
      const versions = store.history(runId).length;
      fireEvent.click(radio("Charisma", "+2"));
      // Half made: nothing saved, the frame says so, the +2 already counts in the total.
      expect(store.history(runId).length).toBe(versions);
      expect(within(abilitiesFrame()).getByText("to choose")).toBeTruthy();
      expect(rowOf(abilitiesFrame(), "Charisma").querySelector("td.tot")!.textContent).toBe("12");
      // An ability holding the +2 cannot take the +1.
      expect(radio("Charisma", "+1")).toHaveProperty("disabled", true);
      fireEvent.click(radio("Constitution", "+1"));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(store.history(runId).length).toBe(versions + 1);
      expect(store.load(runId)!.characters[0]!.levels[0]!.choices[bonus.id]).toEqual(["Charisma", "Constitution"]);
      expect(within(abilitiesFrame()).queryByText("to choose")).toBeNull();
      expect(rowOf(abilitiesFrame(), "Constitution").querySelector("td.tot")!.textContent).toBe("15");
    });

    it("moves the base score by one with the Raise and Lower buttons, within 8 to 15, and the counter follows", () => {
      const c = ranger(1);
      const { store, runId } = setup(runWith([c]), c.id);
      expect(within(abilitiesFrame()).getByText("27 / 27 points")).toBeTruthy();
      expect(within(rowOf(abilitiesFrame(), "Strength")).getByRole("button", { name: "Lower Strength" })).toHaveProperty("disabled", true);
      fireEvent.click(within(rowOf(abilitiesFrame(), "Strength")).getByRole("button", { name: "Raise Strength" }));
      expect(store.load(runId)!.characters[0]!.abilities.Strength).toBe(9);
      expect(within(abilitiesFrame()).getByText("28 / 27 points")).toBeTruthy();
      expect(within(rowOf(abilitiesFrame(), "Dexterity")).getByRole("button", { name: "Raise Dexterity" })).toHaveProperty("disabled", true);
    });

    it("moves a score outside the point-buy range back towards it", () => {
      const c = { ...ranger(1), abilities: { ...ranger(1).abilities, Strength: 18, Intelligence: 5 } };
      const { store, runId } = setup(runWith([c]), c.id);
      expect(within(rowOf(abilitiesFrame(), "Strength")).getByRole("button", { name: "Raise Strength" })).toHaveProperty("disabled", true);
      fireEvent.click(within(rowOf(abilitiesFrame(), "Strength")).getByRole("button", { name: "Lower Strength" }));
      expect(store.load(runId)!.characters[0]!.abilities.Strength).toBe(15);
      expect(within(rowOf(abilitiesFrame(), "Intelligence")).getByRole("button", { name: "Lower Intelligence" })).toHaveProperty("disabled", true);
      fireEvent.click(within(rowOf(abilitiesFrame(), "Intelligence")).getByRole("button", { name: "Raise Intelligence" }));
      expect(store.load(runId)!.characters[0]!.abilities.Intelligence).toBe(8);
    });

    it("settles the level-1 bonus row in the Abilities frame, in the list and in the tree", () => {
      const c = ranger(1);
      setup(runWith([c]), c.id);
      expect(within(level(1)).getByText("Settled in the Abilities frame")).toBeTruthy();
      expect(within(level(1)).queryByRole("button", { name: /^ability scores/ })).toBeNull();
      fireEvent.click(screen.getByRole("checkbox", { name: "Tree" }));
      expect(within(level(1)).getByText("Settled in the Abilities frame")).toBeTruthy();
      expect(within(level(1)).queryByRole("button", { name: /^ability scores/ })).toBeNull();
    });

    it("drops a half-made bonus when the stored choice or the level-1 class changes under the same character", () => {
      const c = ranger(1);
      const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!;
      const view = (character: Character) => (
        <I18nContext.Provider value={createI18n("en")}>
          <Abilities data={data} character={character} issues={[]} onBase={() => {}} onBonus={() => {}} />
        </I18nContext.Provider>
      );
      const { rerender } = render(view(c));
      const total = (ability: string) => rowOf(abilitiesFrame(), ability).querySelector("td.tot")!.textContent;
      fireEvent.click(within(rowOf(abilitiesFrame(), "Charisma")).getByRole("radio", { name: "+2 Charisma" }));
      expect(total("Charisma")).toBe("12");
      const restored = { ...c, levels: [{ ...c.levels[0]!, choices: { ...c.levels[0]!.choices, [bonus.id]: ["Dexterity", "Wisdom"] } }] };
      rerender(view(restored));
      expect(within(rowOf(abilitiesFrame(), "Charisma")).getByRole("radio", { name: "+2 Charisma" })).toHaveProperty("checked", false);
      expect(within(rowOf(abilitiesFrame(), "Dexterity")).getByRole("radio", { name: "+2 Dexterity" })).toHaveProperty("checked", true);
      expect(total("Charisma")).toBe("10");
      expect(total("Dexterity")).toBe("17");
      // A half-made bonus, then the level-1 class cleared.
      const empty = { ...c, levels: [{ class: "", choices: {} as Record<string, Choice> }] };
      rerender(view({ ...c, levels: [{ ...c.levels[0]!, choices: {} }] }));
      fireEvent.click(within(rowOf(abilitiesFrame(), "Charisma")).getByRole("radio", { name: "+2 Charisma" }));
      expect(total("Charisma")).toBe("12");
      rerender(view(empty));
      expect(total("Charisma")).toBe("10");
    });

    it("asks for the level-1 class first when there is none: radios disabled, no throw", () => {
      const c = { ...ranger(1), levels: [{ class: "", choices: {} as Record<string, Choice> }] };
      setup(runWith([c]), c.id);
      expect(within(abilitiesFrame()).getByText("Choose the level 1 class first")).toBeTruthy();
      for (const input of within(abilitiesFrame()).getAllByRole("radio")) expect(input).toHaveProperty("disabled", true);
    });
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

    describe("enriched spell entries (school, same source, other source)", () => {
      /** A High Elf Cleric 1 / Bard 4 whose High Elf cantrip is Minor Illusion. */
      function clericBard(): Character {
        const c: Character = { ...bard(5), id: "cb", levels: ["Cleric", "Bard", "Bard", "Bard", "Bard"].map((class_) => ({ class: class_, choices: {} as Record<string, Choice> })) };
        c.levels[0]!.choices[slotOf(c, 1, "HighElfCantrip").id] = ["Target_MinorIllusion"];
        return c;
      }
      const entry = (dialog: HTMLElement, id: string) => within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "spell", id) });

      it("shows a spell the High Elf row already gave, enabled, with its source and both abilities, in the Bard cantrip picker", () => {
        const c = clericBard();
        setup(runWith([c]), c.id);
        toFrench();
        // Level 5 offers the Bard cantrip first, then the Bard spell.
        fireEvent.click(within(frLevel(5)).getAllByRole("button", { name: /^sorts \(1\)/ })[0]!);
        const dialog = screen.getByRole("dialog");
        const box = entry(dialog, "Target_MinorIllusion");
        expect(box).toHaveProperty("disabled", false);
        expect(said(box)).toContain("Déjà connu par Haut-elfe, lancé avec Intelligence ; ici avec Charisme");
        expect(box.closest("label")!.className).not.toContain("off");
        fireEvent.click(box);
        fireEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
        expect(screen.queryByRole("dialog")).toBeNull();
      });

      it("greys and disables a spell this source already knows, with its reason", () => {
        const c = { ...bard(2), id: "b2" };
        c.levels[0]!.choices[slotOf(c, 1, "BardSpells").id] = ["Target_HealingWord", "Target_Sleep", "Target_Bane", "Target_Heroism"];
        setup(runWith([c]), c.id);
        toFrench();
        fireEvent.click(within(frLevel(2)).getByRole("button", { name: /^sorts \(1\)/ }));
        const dialog = screen.getByRole("dialog");
        const healing = entry(dialog, "Target_HealingWord");
        expect(healing).toHaveProperty("disabled", true);
        expect(healing).toHaveProperty("checked", false);
        expect(healing.closest("label")!.className).toContain("off");
        expect(said(healing)).toContain("Déjà connu par cette source");
        expect(said(entry(dialog, "Target_CharmPerson"))).not.toContain("Déjà connu par cette source");
      });

      it("shows each spell's school name, nothing for a spell without one", () => {
        const c = bard(2);
        setup(runWith([c]), c.id);
        toFrench();
        fireEvent.click(within(frLevel(2)).getByRole("button", { name: /^sorts \(1\)/ }));
        const dialog = screen.getByRole("dialog");
        expect(data.rules.spells["Target_HealingWord"]!.school).toBe("Evocation");
        const healing = entry(dialog, "Target_HealingWord").closest("label")!;
        expect(within(healing).getByText("Évocation")).toBeTruthy();
        expect(said(entry(dialog, "Target_HealingWord"))).toContain("Évocation");
      });

      it("shows the school name in English too, and none for a spell whose school is null", () => {
        const c = bard(2);
        const none = Object.entries(data.rules.spells).find(([id, def]) => def.school === null && data.rules.lists[slotOf(c, 2, "BardSpells").selector.list]!.items.includes(id));
        setup(runWith([c]), c.id);
        fireEvent.click(within(level(2)).getByRole("button", { name: /^spells \(1\)/ }));
        const dialog = screen.getByRole("dialog");
        const healing = within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", "Target_HealingWord") }).closest("label")!;
        expect(within(healing).getByText("Evocation")).toBeTruthy();
        if (none !== undefined) expect(within(within(dialog).getByRole("checkbox", { name: gameName(data, "en", "spell", none[0]) }).closest("label")!).queryByText(/Evocation|Illusion|Necromancy|Abjuration/)).toBeNull();
        else expect(Object.values(data.rules.spells).some((def) => def.school === null)).toBe(true);
      });

      it("says only which source knows a spell when that source casts it with no ability (Ritual Caster), and adds this slot's ability", () => {
        const c = bard(5);
        c.levels[3]!.choices[featSlot(4)] = ["RitualCaster"];
        c.levels[3]!.choices[`${featSlot(4)}/0`] = ["Target_FindFamiliar", "Target_Longstrider"];
        setup(runWith([c]), c.id);
        toFrench();
        fireEvent.click(within(frLevel(5)).getByRole("button", { name: /^sorts \(1\)/ }));
        const dialog = screen.getByRole("dialog");
        const feat = gameName(data, "fr", "feat", "RitualCaster");
        expect(said(entry(dialog, "Target_Longstrider"))).toContain(`Déjà connu par ${feat} ; ici avec Charisme`);
      });

      it("keeps a stored spell known by the same source checked, with its reason, so it can be unchecked", () => {
        const c = { ...bard(2), id: "b3" };
        c.levels[0]!.choices[slotOf(c, 1, "BardSpells").id] = ["Target_HealingWord", "Target_Sleep", "Target_Bane", "Target_Heroism"];
        c.levels[1]!.choices[slotOf(c, 2, "BardSpells").id] = ["Target_HealingWord"];
        setup(runWith([c]), c.id);
        toFrench();
        fireEvent.click(within(frLevel(2)).getByRole("button", { name: /^sorts \(1\)/ }));
        const dialog = screen.getByRole("dialog");
        const healing = entry(dialog, "Target_HealingWord");
        expect(healing).toHaveProperty("checked", true);
        expect(healing).toHaveProperty("disabled", false);
        expect(said(healing)).toContain("Déjà connu par cette source");
        fireEvent.click(healing);
        expect(healing).toHaveProperty("checked", false);
        expect(healing).toHaveProperty("disabled", true);
      });
    });

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
    const raceButton = () => within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Change — Race/ }) as HTMLButtonElement;

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
      fireEvent.click(within(screen.getByRole("region", { name: "Creation" })).getByRole("button", { name: /^Change — Background/ }));
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

describe("skill and expertise pickers", () => {
  const GUILD_ARTISAN = "e9aeac40-6c4e-4d81-9a24-e9eeb6208e85";
  const french = () => fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
  const niveau = (n: number) => screen.getByRole("group", { name: `Niveau ${n}` });
  /** A High Elf Guild Artisan Lore Bard of 12 levels: Performance, Deception, Acrobatics at 1; Intimidation, Stealth, History at 3 with expertise in Intimidation and Performance. */
  function loreBard(): { c: Character; expertise10: string; level10: number } {
    const c: Character = { ...ranger(1), id: "bard", race: "Elf", subrace: "Elf_HighElf", background: GUILD_ARTISAN, levels: Array.from({ length: 12 }, () => ({ class: "Bard", choices: {} as Record<string, Choice> })) };
    c.levels[2]!.choices["subclass:Bard"] = ["LoreCollege"];
    const levels = resolve(c, data).levels;
    const of = (n: number, fn: string) => levels[n - 1]!.slots.find((s) => s.selector.function === fn)!.id;
    c.levels[0]!.choices[of(1, "SelectSkills")] = ["Performance", "Deception", "Acrobatics"];
    c.levels[2]!.choices[of(3, "SelectSkills")] = ["Intimidation", "Stealth", "History"];
    c.levels[2]!.choices[of(3, "SelectSkillsExpertise")] = ["Intimidation", "Performance"];
    // The Bard's second expertise slot, wherever the data puts it.
    const level10 = levels.findIndex((l, i) => i > 2 && l.slots.some((s) => s.selector.function === "SelectSkillsExpertise")) + 1;
    return { c, expertise10: of(level10, "SelectSkillsExpertise"), level10 };
  }

  it("greys and disables at the second Bard expertise slot a skill already in expertise, with its reason, in French", () => {
    const { c, level10 } = loreBard();
    setup(runWith([c]), c.id);
    french();
    fireEvent.click(within(niveau(level10)).getByRole("button", { name: /^expertise/ }));
    const dialog = screen.getByRole("dialog");
    const intimidation = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Intimidation") });
    expect(intimidation).toHaveProperty("disabled", true);
    expect(intimidation).toHaveProperty("checked", false);
    expect(intimidation.closest("label")!.className).toContain("off");
    expect(said(intimidation)).toContain("Déjà en expertise");
    const arcana = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Arcana") });
    expect(arcana).toHaveProperty("disabled", true);
    expect(said(arcana)).toContain("Demande la maîtrise de la compétence");
    const persuasion = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Persuasion") });
    expect(persuasion).toHaveProperty("disabled", false);
  });

  it("shows on a level-1 skill pick of an Elf that the race already grants Perception, still enabled; each entry with its ability and signed value", () => {
    const c: Character = { ...ranger(1), race: "Elf", subrace: "Elf_HighElf" };
    const run = runWith([c]);
    setup(run, c.id);
    french();
    fireEvent.click(within(niveau(1)).getByRole("button", { name: /^compétences/ }));
    const dialog = screen.getByRole("dialog");
    // `ranger` stores Perception at this slot: a slot's own picks never refuse themselves.
    const perception = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Perception") });
    expect(perception).toHaveProperty("checked", true);
    expect(perception).toHaveProperty("disabled", false);
    expect(said(perception).some((text) => text?.startsWith("Déjà donnée par la race : ce choix ne rapporte rien"))).toBe(true);
    const values = new Map(characterSkillValues(c, data, 1, rulesetEffects(run.difficulty, data).proficiencyBonus).map((v) => [v.skill, v]));
    const boxes = within(within(dialog).getByRole("group", { name: "La liste du jeu" })).getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) {
      const skill = Object.keys(data.skills).find((id) => gameName(data, "fr", "skill", id) === box.getAttribute("aria-label"))!;
      const ability = gameName(data, "fr", "ability", data.skills[skill]!);
      const value = signed(values.get(skill)!.value);
      const text = box.closest("label")!.textContent!;
      expect(text).toContain(`(${ability})`);
      expect(text).toContain(value);
      // Screen readers hear the ability, the value and the status, not only the checkbox's name.
      const facts = said(box)[0]!;
      expect(facts.startsWith(`${ability}, ${value}`)).toBe(true);
      expect(said(box)).toContain(gameDescription(data, "fr", "skill", skill));
    }
    expect(said(perception)[0]).toMatch(/, maîtrise$/);
  });

  it("keeps a stored refused pick checked with its reason so it can be unchecked, then saves without it", () => {
    const { c, expertise10, level10 } = loreBard();
    c.levels[level10 - 1]!.choices[expertise10] = ["Intimidation", "History"];
    const { store, runId } = setup(runWith([c]), c.id);
    french();
    fireEvent.click(within(niveau(level10)).getByRole("button", { name: /^expertise/ }));
    const dialog = screen.getByRole("dialog");
    const intimidation = within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Intimidation") });
    expect(intimidation).toHaveProperty("checked", true);
    expect(intimidation).toHaveProperty("disabled", false);
    expect(said(intimidation)).toContain("Déjà en expertise");
    fireEvent.click(intimidation);
    expect(intimidation).toHaveProperty("checked", false);
    expect(intimidation).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: gameName(data, "fr", "skill", "Persuasion") }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Valider" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect([...(store.load(runId)!.characters[0]!.levels[level10 - 1]!.choices[expertise10] as string[])].sort()).toEqual(["History", "Persuasion"]);
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

describe("creation cards", () => {
  function setupFr(c: Character) {
    const store = createStore(new MemoryBackend());
    store.save(runWith([c]));
    const settings = new MemoryBackend();
    settings.setItem("bg3p:settings", JSON.stringify({ lang: "fr" }));
    window.history.replaceState(null, "", `#/character/${c.id}`);
    render(<App data={data} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
  }
  const creation = () => within(screen.getByRole("region", { name: "Création" }));
  const cardElement = (label: string) => creation().getByRole("button", { name: new RegExp(`^Changer — ${label} :`) }).closest(".idcard") as HTMLElement;
  const card = (label: string) => within(cardElement(label));
  const persuasion = () => Object.keys(data.rules.backgrounds).find((id) => backgroundTraits(data, id).some((trait) => trait.kind === "skill" && trait.skill === "Persuasion"))!;
  const as = (race: Character["race"], subrace: Character["subrace"], background: Character["background"] = persuasion()): Character => ({ ...ranger(1), race, subrace, background });

  it("lists a race's passive with its description and the skill it grants on its card", () => {
    setupFr(as("Elf", null));
    const elf = card("Race");
    expect(elf.getByText("Vision dans le noir")).toBeTruthy();
    expect(elf.getByText(gameDescription(data, "fr", "passive", "Darkvision")!)).toBeTruthy();
    expect(elf.getByText("Maîtrise : Perception")).toBeTruthy();
    expect(elf.getByText("Vitesse : 9 m")).toBeTruthy();
  });

  it("lists the High Elf's spell choice, the Wood Elf's added speed and the Gold Dwarf's hit points", () => {
    setupFr(as("Elf", "Elf_HighElf"));
    expect(card("Sous-race").getByText("Sorts mineurs (1), lancé avec Intelligence")).toBeTruthy();
    cleanup();
    setupFr(as("Elf", "Elf_WoodElf"));
    expect(card("Sous-race").getByText("Vitesse : +1,5 m")).toBeTruthy();
    cleanup();
    setupFr(as("Dwarf", "Dwarf_GoldHill"));
    expect(card("Sous-race").getByText("+1 point de vie par niveau")).toBeTruthy();
  });

  it("shows no trait list for an identifier absent from the game data", () => {
    setupFr(as("NoSuchRace", null));
    expect(cardElement("Race").querySelector(".traits")).toBeNull();
    expect(card("Race").queryByText("Aucun trait propre")).toBeNull();
  });

  it("shows the background's game description and the skill it grants", () => {
    const id = persuasion();
    setupFr(as("Elf", null, id));
    const background = card("Historique");
    expect(background.getByText(gameDescription(data, "fr", "background", id)!)).toBeTruthy();
    expect(background.getByText("Maîtrise : Persuasion")).toBeTruthy();
  });

  it("prefixes the Duergar's traits above level 1 with their level", () => {
    setupFr(as("Duergar", null));
    const duergar = card("Race");
    expect(duergar.getByText(/^Niveau 3 :/)).toBeTruthy();
    expect(duergar.getByText(/^Niveau 5 :/)).toBeTruthy();
  });

  it("shows under each race of the picker what it gives and its subraces, and under each subrace its traits", () => {
    setupFr(as("Dwarf", null));
    fireEvent.click(creation().getByRole("button", { name: /^Changer — Race :/ }));
    let dialog = within(screen.getByRole("dialog"));
    const dwarf = dialog.getByRole("radio", { name: "Nain" });
    const lines = (dwarf.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)!.textContent);
    expect(lines.some((line) => /^Sous-races : .*Duergar/.test(line ?? ""))).toBe(true);
    expect(lines).toContain("Vitesse : 7,5 m");
    fireEvent.click(dialog.getByRole("button", { name: "Annuler" }));
    cleanup();
    setupFr(as("Elf", "Elf_HighElf"));
    fireEvent.click(creation().getByRole("button", { name: /^Changer — Sous-race :/ }));
    dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("Sorts mineurs (1), lancé avec Intelligence")).toBeTruthy();
  });

  it("shows a race outside the game data without a trait list, and an undecided background as to decide", () => {
    setupFr(as({ offData: "ModRace" }, null, ""));
    expect(card("Race").getByText("ModRace")).toBeTruthy();
    expect(card("Race").queryByText("Aucun trait propre")).toBeNull();
    expect(cardElement("Race").querySelector(".traits")).toBeNull();
    expect(card("Historique").getByText("à décider")).toBeTruthy();
    expect(cardElement("Historique").querySelector(".traits")).toBeNull();
  });
});
