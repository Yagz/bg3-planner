import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyRun } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { stubData, text } from "./stubData.ts";

const AT = "2026-11-25T10:00:00.000Z";
const SLOTS: Record<string, string> = { RING_A: "Ring", RING_B: "Ring", RING_C: "Ring" };
const DATA = stubData({ "item:RING_C": text("Ring C (placeholder)") }, { "item:RING_C": text("Anneau C (placeholder)") });

/** A storage holding one run "old" stored in version 3, whose player carries one ring too many and an item outside the data. */
function v3Backend(): MemoryBackend {
  const character = { id: "c1", who: "player", race: "", subrace: null, background: "", abilities: { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 }, levels: [], items: ["RING_A", "RING_B", "RING_C", "UNKNOWN"], notes: "" };
  const v3 = { ...emptyRun("old"), name: "Old", version: 3, characters: [character] };
  const backend = new MemoryBackend();
  backend.items.set("bg3p:run:old", JSON.stringify({ history: [{ at: AT, text: JSON.stringify(v3) }] }));
  return backend;
}

function renderApp(backend: MemoryBackend, settings: MemoryBackend) {
  const store = createStore(backend, { itemSlot: (id) => SLOTS[id] ?? null });
  return render(<App data={DATA} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
}

function banner(): HTMLElement | null {
  return screen.queryAllByRole("status").find((element) => element.classList.contains("migrated")) ?? null;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("migration banner", () => {
  it("lists the items a stored version-3 run could not place, by character and item name, with the reason", () => {
    renderApp(v3Backend(), new MemoryBackend());
    const shown = banner();
    expect(shown).not.toBeNull();
    expect(shown!.textContent).toContain("This run comes from an older format (BG3P3): 2 items could not be placed and are written in their character's notes.");
    // The list is folded by default, so a long one never fills a phone screen; the count and Close stay visible.
    const details = shown!.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")!.textContent).toBe("Show the 2 items");
    expect(screen.getByRole("button", { name: "Close" }).closest("details")).toBeNull();
    expect([...shown!.querySelectorAll("li")].every((li) => details.contains(li))).toBe(true);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.open).toBe(true);
    expect([...details.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Player: Ring C (placeholder) (slot already taken)", "Player: UNKNOWN (no known slot)"]);
    // The banner sits above the screen content, not inside it.
    expect(shown!.closest("main")).toBeNull();
  });

  it("speaks French in the French interface", () => {
    const settings = new MemoryBackend();
    settings.items.set("bg3p:settings", JSON.stringify({ lang: "fr" }));
    renderApp(v3Backend(), settings);
    expect(banner()!.textContent).toContain("Cette partie vient d’un ancien format (BG3P3) : 2 objets n’ont pas pu être placés et sont notés dans les notes de leur personnage.");
    expect(banner()!.querySelector("summary")!.textContent).toBe("Voir les 2 objets");
    expect([...banner()!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["Joueur : Anneau C (placeholder) (emplacement déjà occupé)", "Joueur : UNKNOWN (aucun emplacement connu)"]);
    expect(screen.getByRole("button", { name: "Fermer" })).toBeTruthy();
  });

  it("Close hides it, remembered for this run and stored version, so it stays hidden on the next visit", () => {
    const backend = v3Backend();
    const settings = new MemoryBackend();
    renderApp(backend, settings);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(banner()).toBeNull();
    expect(settings.items.get("bg3p:migrated:old")).toBe(AT);
    cleanup();
    renderApp(backend, settings);
    expect(banner()).toBeNull();
  });

  it("shows again when the dismissal was for another stored version, or the storage refuses to read it", () => {
    const settings = new MemoryBackend();
    settings.items.set("bg3p:migrated:old", "2026-11-24T10:00:00.000Z");
    renderApp(v3Backend(), settings);
    expect(banner()).not.toBeNull();
    cleanup();
    const refusing = new MemoryBackend();
    refusing.getItem = (key: string) => {
      if (key.startsWith("bg3p:migrated:")) throw new Error("refused");
      return MemoryBackend.prototype.getItem.call(refusing, key);
    };
    refusing.setItem = (key: string, value: string) => {
      if (key.startsWith("bg3p:migrated:")) throw new Error("refused");
      MemoryBackend.prototype.setItem.call(refusing, key, value);
    };
    renderApp(v3Backend(), refusing);
    expect(banner()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(banner()).toBeNull();
  });

  it("shows nothing for a stored version-4 run", () => {
    const backend = new MemoryBackend();
    createStore(backend).save({ ...emptyRun("new"), name: "New" });
    renderApp(backend, new MemoryBackend());
    expect(screen.getByRole("combobox", { name: "Run" })).toBeTruthy();
    expect(banner()).toBeNull();
  });
});
