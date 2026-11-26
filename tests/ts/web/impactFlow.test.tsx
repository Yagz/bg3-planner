import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { resolve } from "../../../src/engine/progression.ts";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Ability, Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { gameName } from "../../../web/src/names.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";
import { StreamingBlob } from "./streamingBlob.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
  vi.stubGlobal("Blob", StreamingBlob);
});
afterEach(() => {
  cleanup();
});

function runOf(...characters: Character[]): Run {
  const run = emptyRun("r");
  run.characters = characters;
  run.party["1"].active = characters.map((c) => c.id);
  return run;
}

/** Fills every open selector slot with real, distinct picks from its list (the first unused items). */
function fill(c: Character): Character {
  const used = new Set<string>();
  for (const level of resolve(c, data).levels) {
    const choices = c.levels[level.level - 1]!.choices;
    for (const slot of level.slots) {
      const s = slot.selector;
      if (s.function === "AddSpells" || s.function === "ReplacePassives") continue;
      const items = data.rules.lists[s.list]?.items ?? [];
      if (s.function === "SelectAbilityBonus") choices[slot.id] = items.slice(0, s.bonuses.length);
      else if (s.function === "SelectAbilities") choices[slot.id] = Array.from({ length: s.count }, () => "Wisdom");
      else {
        const picks = items.filter((item) => !used.has(item)).slice(0, s.count);
        for (const pick of picks) used.add(pick);
        choices[slot.id] = picks;
      }
    }
  }
  return c;
}

/** Gale's identity and preset scores, Wizard at every level, with `school` at level 2 and every open slot filled from the game's lists. */
function gale(levels: number, school: string): Character {
  const origin = data.rules.origins["Gale"]!;
  return fill({
    id: "gale",
    who: "Gale",
    race: origin.race ?? "",
    subrace: origin.subrace,
    background: origin.background ?? "",
    abilities: { ...origin.abilities! },
    levels: Array.from({ length: levels }, (_, i) => ({ class: "Wizard", choices: (i === 1 ? { "subclass:Wizard": [school] } : {}) as Record<string, Choice> })),
    items: [],
    notes: "",
  });
}

/** The character without the picks of `slots` (level, slot) and with `subclass` at `slot`: what applying a subclass swap must store, and nothing else. */
function expectedAfter(before: Character, removed: [number, string][], level: number, slot: string, subclass: string): Character {
  const expected = structuredClone(before);
  for (const [n, key] of removed) delete expected.levels[n - 1]!.choices[key];
  expected.levels[level - 1]!.choices[slot] = [subclass];
  return expected;
}

function rowOf(subclass: string, level: number) {
  const table = data.rules.classes[subclass]!.table;
  return data.rules.progressions.find((p) => p.table === table && p.level === level)!;
}

/** The whole app over a store holding `run`, on the Character screen of `id`. */
function setup(run: Run, id: string) {
  const store = createStore(new MemoryBackend());
  const settings = new MemoryBackend();
  const saved = store.save(run);
  window.history.replaceState(null, "", `#/character/${id}`);
  render(<App data={data} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
  return { store, runId: saved.id, settings };
}

const showTree = () => fireEvent.click(screen.getByRole("checkbox", { name: "Tree" }));
const openAlternative = (subclass: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: "Untaken branches" })).getByRole("button", { name: gameName(data, "en", "class", subclass) }));
/** Restores the version before the current one through the history panel. */
function restorePrevious() {
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  fireEvent.click(screen.getAllByRole("button", { name: /^Restore the version of / })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
  fireEvent.click(screen.getByRole("button", { name: "Character" }));
}
const names = (region: HTMLElement) => within(region).getAllByRole("listitem").map((li) => li.textContent ?? "");

describe("Tree view and impact preview", () => {
  it("previews a school swap from the tree, applies it as one history entry, and restoring it brings back every removed pick", async () => {
    const before = gale(4, "EvocationSchool");
    const { store, runId, settings } = setup(runOf(before), before.id);
    showTree();
    expect(JSON.parse(settings.getItem("bg3p:settings")!).tree).toBe(true);
    openAlternative("NecromancySchool");

    const dialog = screen.getByRole("dialog");
    const gained = names(within(dialog).getByRole("region", { name: "Gained" })).join("\n");
    const lost = names(within(dialog).getByRole("region", { name: "Lost" })).join("\n");
    for (const id of rowOf("NecromancySchool", 2).passives_added) expect(gained).toContain(gameName(data, "en", "passive", id));
    for (const id of rowOf("EvocationSchool", 2).passives_added) expect(lost).toContain(gameName(data, "en", "passive", id));
    // Every removed pick is named: the picks stored under Evocation's slots.
    const removed = [2, 3, 4].flatMap((n) => Object.entries(before.levels[n - 1]!.choices).filter(([slot]) => slot.startsWith(rowOf("EvocationSchool", n).uuid)).map(([slot, choice]) => ({ n, slot, choice })));
    expect(removed.length).toBeGreaterThan(0);
    const removedGroup = within(dialog).getByRole("group", { name: "Removed choices" });
    expect(removedGroup.querySelectorAll(".pill")).toHaveLength(removed.length);
    for (const { choice } of removed) for (const id of choice as string[]) expect(removedGroup.textContent).toContain(gameName(data, "en", "spell", id));

    const versions = store.history(runId).length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    const history = store.history(runId);
    expect(history.length).toBe(versions + 1);
    // Exactly the listed picks are removed; every other choice is stored as it was.
    expect(store.load(runId)!.characters[0]).toEqual(expectedAfter(before, removed.map(({ n, slot }) => [n, slot]), 2, "subclass:Wizard", "NecromancySchool"));

    // Restoring the previous version from the history panel brings back every removed pick, on screen too.
    restorePrevious();
    expect(store.load(runId)!.characters[0]).toEqual(before);
    expect(screen.getByRole("button", { name: /^subclass/ }).textContent).toBe(gameName(data, "en", "class", "EvocationSchool"));
    const shown = screen.getByRole("main").textContent ?? "";
    for (const { choice } of removed) for (const id of choice as string[]) expect(shown).toContain(gameName(data, "en", "spell", id));
  });

  it("keeps a later feat made impossible by an ability-bonus change, flagged in the preview and at its level", () => {
    const scores: Record<Ability, number> = { Strength: 15, Dexterity: 12, Constitution: 15, Intelligence: 8, Wisdom: 13, Charisma: 8 };
    const c: Character = {
      id: "r",
      who: "player",
      race: "Halfling",
      subrace: "Halfling_Lightfoot",
      background: Object.keys(data.rules.backgrounds)[0]!,
      abilities: { ...scores },
      levels: Array.from({ length: 4 }, () => ({ class: "Ranger", choices: {} as Record<string, Choice> })),
      items: [],
      notes: "",
    };
    const bonus = resolve(c, data).levels[0]!.slots.find((s) => s.selector.function === "SelectAbilityBonus")!.id;
    c.levels[0]!.choices[bonus] = ["Dexterity", "Wisdom"];
    c.levels[3]!.choices["feat:4"] = ["DefensiveDuelist"];
    const { store, runId } = setup(runOf(c), c.id);
    showTree();

    fireEvent.click(within(screen.getByRole("region", { name: "Abilities" })).getByRole("radio", { name: `+2 ${gameName(data, "en", "ability", "Strength")}` }));

    const dialog = screen.getByRole("dialog");
    const flagged = within(dialog).getByRole("group", { name: "Later choices that no longer hold" }).textContent ?? "";
    expect(flagged).toContain(gameName(data, "en", "feat", "DefensiveDuelist"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    const saved = store.load(runId)!.characters[0]!;
    expect(saved.levels[0]!.choices[bonus]).toEqual(["Strength", "Wisdom"]);
    expect(saved.levels[3]!.choices["feat:4"]).toEqual(["DefensiveDuelist"]);
    expect(within(screen.getByRole("group", { name: "Level 4" })).getByText(new RegExp(gameName(data, "en", "feat", "DefensiveDuelist")), { selector: ".pill.bad" })).toBeTruthy();
  });

  it("removes exactly the listed picks and keeps a later feat made impossible by the same subclass swap, flagged; restoring brings everything back", () => {
    // Nature Domain grants heavy armour and has its own skill and cantrip slots; Light Domain has neither.
    const before = fill({
      id: "cleric",
      who: "player",
      race: "Human",
      subrace: null,
      background: Object.keys(data.rules.backgrounds)[0]!,
      abilities: { Strength: 15, Dexterity: 10, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
      levels: Array.from({ length: 4 }, (_, i) => ({ class: "Cleric", choices: (i === 0 ? { "subclass:Cleric": ["NatureDomain"] } : {}) as Record<string, Choice> })),
      items: [],
      notes: "",
    });
    before.levels[3]!.choices["feat:4"] = ["HeavyArmorMaster"];
    const nature = rowOf("NatureDomain", 1).uuid;
    const removed = Object.entries(before.levels[0]!.choices).filter(([slot]) => slot.startsWith(nature));
    expect(removed.length).toBe(2);
    const { store, runId } = setup(runOf(before), before.id);
    showTree();
    openAlternative("LightDomain");

    const dialog = screen.getByRole("dialog");
    const removedGroup = within(dialog).getByRole("group", { name: "Removed choices" });
    expect(removedGroup.querySelectorAll(".pill")).toHaveLength(removed.length);
    expect(removedGroup.textContent).toContain(gameName(data, "en", "skill", (removed[0]![1] as string[])[0]!));
    expect(removedGroup.textContent).toContain(gameName(data, "en", "spell", (removed[1]![1] as string[])[0]!));
    const flagged = within(dialog).getByRole("group", { name: "Later choices that no longer hold" });
    expect(flagged.querySelectorAll(".pill.bad")).toHaveLength(1);
    expect(flagged.textContent).toContain(gameName(data, "en", "feat", "HeavyArmorMaster"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));

    expect(store.load(runId)!.characters[0]).toEqual(expectedAfter(before, removed.map(([slot]) => [1, slot]), 1, "subclass:Cleric", "LightDomain"));
    expect(within(screen.getByRole("group", { name: "Level 4" })).getByText(new RegExp(gameName(data, "en", "feat", "HeavyArmorMaster")), { selector: ".pill.bad" })).toBeTruthy();
    restorePrevious();
    expect(store.load(runId)!.characters[0]).toEqual(before);
    const shown = screen.getByRole("main").textContent ?? "";
    expect(shown).toContain(gameName(data, "en", "skill", (removed[0]![1] as string[])[0]!));
    expect(shown).toContain(gameName(data, "en", "spell", (removed[1]![1] as string[])[0]!));
  });

  it("names the picks of a removed last level that grants nothing; Apply removes them, Cancel changes nothing", async () => {
    // A Ranger's level 2 grants no feature; its spells are its only content.
    const c: Character = {
      id: "r",
      who: "player",
      race: "Halfling",
      subrace: "Halfling_Lightfoot",
      background: Object.keys(data.rules.backgrounds)[0]!,
      abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 },
      levels: [1, 2].map(() => ({ class: "Ranger", choices: {} as Record<string, Choice> })),
      items: [],
      notes: "",
    };
    const spells = resolve(c, data).levels[1]!.slots.find((s) => s.selector.function === "SelectSpells")!;
    const picks = data.rules.lists[spells.selector.list]!.items.slice(0, 2);
    c.levels[1]!.choices[spells.id] = picks;
    const { store, runId } = setup(runOf(c), c.id);
    const stored = await encode(store.load(runId)!);
    const versions = store.history(runId).length;

    fireEvent.click(screen.getByRole("button", { name: "Remove level 2" }));
    const removed = within(screen.getByRole("dialog")).getByRole("group", { name: "Removed choices" });
    expect(removed.querySelectorAll(".pill")).toHaveLength(1);
    for (const id of picks) expect(removed.textContent).toContain(gameName(data, "en", "spell", id));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(store.history(runId).length).toBe(versions);
    expect(await encode(store.load(runId)!)).toBe(stored);

    fireEvent.click(screen.getByRole("button", { name: "Remove level 2" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply" }));
    expect(store.history(runId).length).toBe(versions + 1);
    expect(store.load(runId)!.characters[0]!.levels).toEqual([c.levels[0]]);
  });

  it("applies an ability step over the point-buy budget directly, without a preview", () => {
    const c = gale(1, "EvocationSchool");
    const { store, runId } = setup(runOf(c), c.id);
    const strength = gameName(data, "en", "ability", "Strength");
    const next = c.abilities.Strength + 1;
    fireEvent.click(screen.getByRole("button", { name: `Raise ${strength}` }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.load(runId)!.characters[0]!.abilities.Strength).toBe(next);
    expect(screen.getByText("Point buy: 28 points spent for a budget of 27.")).toBeTruthy();
  });

  it("changes nothing on Cancel: the run encodes byte for byte as before", async () => {
    const before = gale(4, "EvocationSchool");
    const { store, runId } = setup(runOf(before), before.id);
    const stored = await encode(store.load(runId)!);
    const versions = store.history(runId).length;
    showTree();
    openAlternative("NecromancySchool");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.history(runId).length).toBe(versions);
    expect(await encode(store.load(runId)!)).toBe(stored);
    expect(screen.getByRole("button", { name: /^subclass/ }).textContent).toBe(gameName(data, "en", "class", "EvocationSchool"));
  });
});
