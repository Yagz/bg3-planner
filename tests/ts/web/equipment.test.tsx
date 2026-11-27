import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { GameData } from "../../../src/data/types.ts";
import { itemFirstAct, itemRarity, itemsForSlot } from "../../../src/engine/equipment.ts";
import { resolve } from "../../../src/engine/progression.ts";
import type { EquipmentSlot } from "../../../src/plan/equipmentSlots.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Choice, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { gameName } from "../../../web/src/names.ts";
import { loadTab, saveTab } from "../../../web/src/state/sessionTab.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { setLanguage } from "./header.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { realData } from "./realData.ts";

let data: GameData;
beforeAll(() => {
  data = realData();
  probe = fighter();
});
afterEach(cleanup);

function fighter(equipment: Character["equipment"] = { "1": {}, "2": {}, "3": {} }, id = "fighter"): Character {
  return {
    id,
    who: "player",
    race: "Human",
    subrace: null,
    background: Object.keys(data.rules.backgrounds)[0]!,
    abilities: { Strength: 15, Dexterity: 14, Constitution: 14, Intelligence: 8, Wisdom: 10, Charisma: 8 },
    levels: [{ class: "Fighter", choices: {} as Record<string, Choice> }],
    equipment,
    notes: "",
  };
}

/** A Fighter 1, Bard 2 whose Bard level 1 picked a lute: the instrument comes from character level 2. */
function bard(): Character {
  const c = fighter();
  c.levels = [
    { class: "Fighter", choices: {} },
    { class: "Bard", choices: {} },
  ];
  const slot = resolve(c, data).levels[1]!.slots.find((s) => s.selector.function === "SelectEquipment")!;
  c.levels[1]!.choices[slot.id] = ["ARM_Instrument_Lute"];
  return c;
}

function setup(characters: Character[], id = characters[0]!.id, game: GameData = data) {
  const run: Run = emptyRun("r");
  run.characters = characters;
  run.party["1"].active = characters.map((c) => c.id);
  const store = createStore(new MemoryBackend());
  const saved = store.save(run);
  window.history.replaceState(null, "", `#/character/${id}`);
  render(<App data={game} store={store} settingsBackend={new MemoryBackend()} sessionBackend={new MemoryBackend()} />);
  fireEvent.click(screen.getByRole("tab", { name: /^(Equipment|Équipement)$/ }));
  return { store, runId: saved.id };
}

const card = (slot: EquipmentSlot) => document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
let probe: Character;
/** An item of the slot that bg3.wiki places in `act` only, with a rarity. */
function itemIn(slot: EquipmentSlot, act: 1 | 2 | 3, rarity?: string): string {
  const found = itemsForSlot(slot, probe, data).find((id) => itemFirstAct(id, data) === act && itemRarity(id, data) !== null && (rarity === undefined || itemRarity(id, data) === rarity) && (data.wiki[id]?.locations.length ?? 0) > 0);
  if (found === undefined) throw new Error(`no ${slot} item found first in act ${act}`);
  return found;
}
const name = (id: string) => gameName(data, "en", "item", id);

describe("Equipment tab", () => {
  it("act tabs switch the shown act; the note counts the act's own changes", () => {
    const helmet = itemIn("Helmet", 1);
    const cloak = itemIn("Cloak", 1);
    setup([fighter({ "1": { Helmet: helmet }, "2": { Cloak: cloak, Helmet: null }, "3": {} })]);
    expect(screen.getByText("1 slot chosen")).toBeTruthy();
    expect(within(card("Helmet")).getByText(name(helmet))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Act 2" }));
    expect(screen.getByText("2 changes from act 1; the rest is inherited")).toBeTruthy();
    expect(within(card("Helmet")).getByText("Empty")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Act 3" }));
    expect(screen.getByText("0 changes from act 2; the rest is inherited")).toBeTruthy();
    expect(within(card("Cloak")).getByText(name(cloak))).toBeTruthy();
  });

  it("an inherited slot is dashed and says hérité de l'acte 1; the Bard's instrument says choisi au niveau 2", () => {
    const amulet = itemIn("Amulet", 1);
    setup([bard()].map((c) => ({ ...c, equipment: { "1": { Amulet: amulet }, "2": {}, "3": {} } })));
    setLanguage("fr");
    fireEvent.click(screen.getByRole("button", { name: "Acte 2" }));
    expect(card("Amulet").className).toContain("inh");
    expect(card("Amulet").textContent).toContain("hérité de l’acte 1");
    expect(card("MusicalInstrument").className).toContain("inh");
    expect(card("MusicalInstrument").textContent).toContain("choisi au niveau 2");
    expect(card("Helmet").className).not.toContain("inh");
  });

  it("each slot shows the game slot name, the item name, its rarity class and its wiki location with the act", () => {
    const rare = itemIn("Helmet", 2, "rare");
    setup([fighter({ "1": { Helmet: rare }, "2": {}, "3": {} })]);
    const helmet = card("Helmet");
    expect(within(helmet).getByText(gameName(data, "en", "slot", "Helmet"))).toBeTruthy();
    expect(helmet.querySelector(".it")!.className).toContain("r-rare");
    expect(within(helmet).getByText(name(rare))).toBeTruthy();
    // The rarity is a visible word at the head of the location line, coloured as reinforcement.
    expect(helmet.querySelector(".where")!.textContent).toMatch(/^rare · Act 2 · .+/);
    expect(helmet.querySelector(".where .rw")!.className).toContain("r-rare");
    expect(helmet.querySelector(".sr")).toBeNull();
  });

  it("the picker filters by name, act and rarity, chooses, empties for the act, and offers Reprendre l'acte précédent only when the act sets the slot and never at act 1", () => {
    const first = itemIn("Helmet", 1);
    const third = itemIn("Helmet", 3);
    const { store, runId } = setup([fighter()]);
    // Act 1: never the inherit button, even with a value of the act.
    fireEvent.click(card("Helmet"));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Take the previous act's" })).toBeNull();
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: name(third) } });
    expect(within(dialog).getAllByRole("radio").every((radio) => radio.getAttribute("aria-label")!.toLowerCase().includes(name(third).toLowerCase()))).toBe(true);
    fireEvent.change(within(dialog).getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Act filter" }), { target: { value: "upTo" } });
    expect(within(dialog).queryByRole("radio", { name: name(third) })).toBeNull();
    expect(within(dialog).getByRole("radio", { name: name(first) })).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Rarity filter" }), { target: { value: "legendary" } });
    for (const radio of within(dialog).queryAllByRole("radio")) expect(itemRarity(itemsForSlot("Helmet", probe, data).find((id) => name(id) === radio.getAttribute("aria-label"))!, data)).toBe("legendary");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "Rarity filter" }), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: name(first) }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(store.load(runId)!.characters[0]!.equipment["1"]).toEqual({ Helmet: first });
    // Act 2 inherits: no own value, no inherit button; choosing stores it and then offers the button.
    fireEvent.click(screen.getByRole("button", { name: "Act 2" }));
    fireEvent.click(card("Helmet"));
    dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: /· act 2$/ })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Take the previous act's" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Empty for this act" }));
    expect(store.load(runId)!.characters[0]!.equipment["2"]).toEqual({ Helmet: null });
    expect(within(card("Helmet")).getByText("Empty")).toBeTruthy();
    fireEvent.click(card("Helmet"));
    dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Take the previous act's" }));
    expect(store.load(runId)!.characters[0]!.equipment["2"]).toEqual({});
    expect(within(card("Helmet")).getByText(name(first))).toBeTruthy();
  });

  it("RangedOffHand shows Aucun objet connu pour cet emplacement and does not open", () => {
    // The real data now holds light crossbows: take them out to reach a slot with no known item.
    const items = Object.fromEntries(Object.entries(data.rules.items).filter(([, def]) => !(def.slot === "Ranged Main Weapon" && def.properties.includes("Light"))));
    const without: GameData = { ...data, rules: { ...data.rules, items } };
    expect(itemsForSlot("RangedOffHand", probe, without)).toEqual([]);
    setup([fighter()], "fighter", without);
    setLanguage("fr");
    const off = card("RangedOffHand");
    expect(off.textContent).toContain("Aucun objet connu pour cet emplacement");
    fireEvent.click(off);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an unknown item id shows the raw id and the slot still opens", () => {
    setup([fighter({ "1": { Helmet: "NOT_AN_ITEM" }, "2": {}, "3": {} })]);
    expect(within(card("Helmet")).getByText("NOT_AN_ITEM")).toBeTruthy();
    fireEvent.click(card("Helmet"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("an impossible equipment choice is red, never amber, and is counted in the sidebar under Equipment", () => {
    setup([fighter({ "1": { Helmet: "NOT_AN_ITEM" }, "2": {}, "3": {} })]);
    expect(card("Helmet").className).toContain("bad");
    expect(card("Helmet").className).not.toContain("warn");
    expect(within(card("Helmet")).getByText("Impossible choice")).toBeTruthy();
    const notice = screen.getByRole("list", { name: "Equipment notices" }).querySelector("li")!;
    expect(notice.className).toBe("bad");
    // A notice-level issue stays amber.
    cleanup();
    const late = itemIn("Helmet", 3);
    setup([fighter({ "1": { Helmet: late }, "2": {}, "3": {} })]);
    expect(card("Helmet").className).toContain("warn");
    expect(card("Helmet").className).not.toContain("bad");
    expect(screen.getByRole("list", { name: "Equipment notices" }).querySelector("li")!.className).toBe("");
    cleanup();
    setup([fighter({ "1": { Helmet: "NOT_AN_ITEM" }, "2": {}, "3": {} })]);
    fireEvent.click(screen.getByRole("tab", { name: "Sheet" }));
    expect(document.querySelector(".settle")?.textContent ?? "").toContain("Equipment: 1 impossible choice");
    expect(document.querySelector(".settle")?.textContent ?? "").not.toContain("Creation");
  });

  it("equipment notices appear above the silhouette", () => {
    const late = itemIn("Helmet", 3);
    setup([fighter({ "1": { Helmet: late }, "2": {}, "3": {} })]);
    const notices = screen.getByRole("list", { name: "Equipment notices" });
    expect(notices.textContent).toContain(`${name(late)}: only found in act 3, equipped in act 1.`);
    const doll = document.querySelector(".doll")!;
    expect(notices.compareDocumentPosition(doll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card("Helmet").className).toContain("warn");
    // They are not placed at character creation.
    fireEvent.click(screen.getByRole("tab", { name: "Sheet" }));
    expect(document.querySelector(".creation")?.textContent ?? "").not.toContain("only found in act");
  });

  it("a notice set in act 1 and inherited still shows, with the amber edge, in act 2; never past the act where it stops", () => {
    const late = itemIn("Helmet", 3);
    setup([fighter({ "1": { Helmet: late }, "2": {}, "3": {} })]);
    fireEvent.click(screen.getByRole("button", { name: "Act 2" }));
    expect(screen.getByRole("list", { name: "Equipment notices" }).textContent).toContain(`${name(late)}: only found in act 3, equipped in act 2.`);
    expect(card("Helmet").className).toContain("warn");
    fireEvent.click(screen.getByRole("button", { name: "Act 3" }));
    expect(screen.queryByRole("list", { name: "Equipment notices" })).toBeNull();
    expect(card("Helmet").className).not.toContain("warn");
  });

  it("the footer credits bg3.wiki with its licence", () => {
    setup([fighter()]);
    const foot = screen.getByRole("contentinfo");
    expect(within(foot).getByRole("link", { name: "bg3.wiki" }).getAttribute("href")).toBe("https://bg3.wiki");
    expect(within(foot).getByRole("link", { name: "CC BY-NC-SA 4.0" })).toBeTruthy();
  });

  it("remembers the Equipment tab per character for the session", () => {
    const backend = new MemoryBackend();
    saveTab(backend, "fighter", "equipment");
    expect(loadTab(backend, "fighter")).toBe("equipment");
    expect(loadTab(backend, "other")).toBe("sheet");
  });
});
