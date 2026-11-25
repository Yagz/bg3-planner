import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { createStore } from "../../../web/src/state/storage.ts";
import type { RunStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { StreamingBlob } from "./streamingBlob.ts";
import { stubData, text } from "./stubData.ts";

beforeAll(() => {
  vi.stubGlobal("Blob", StreamingBlob);
});

function renderApp(store: RunStore = createStore(new MemoryBackend()), settings = new MemoryBackend()) {
  render(<App data={stubData()} store={store} settingsBackend={settings} />);
  return { store, settings };
}

function runSelector(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: /run|partie/i }) as HTMLSelectElement;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("app shell", () => {
  it("renders with an empty store", () => {
    renderApp();
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Party" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Character" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import / export" })).toBeTruthy();
    expect(within(screen.getByRole("navigation")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Party", "Character", "History", "Import / export"]);
    expect(screen.getByText("No run yet: create one or import one.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates, renames, duplicates and deletes a run", () => {
    const { store, settings } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(store.list().map((summary) => summary.name)).toEqual(["New run"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("New run");
    expect(JSON.parse(settings.items.get("bg3p:settings")!).currentRun).toBe(store.list()[0]?.id);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Dark urges" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(store.list().map((summary) => summary.name).sort()).toEqual(["Dark urges", "Dark urges (copy)"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges (copy)");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(store.list().map((summary) => summary.name)).toEqual(["Dark urges"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");
  });

  it("switches language without losing the run", () => {
    const { store } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "My run" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    const id = runSelector().value;

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
    expect(screen.getByRole("button", { name: "Partie" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("fr");
    expect(runSelector().value).toBe(id);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("My run");
    expect(store.list()).toHaveLength(1);
  });

  it("shows a persistent banner when storage is unavailable", () => {
    renderApp(createStore(null));
    expect(screen.getByRole("alert").textContent).toMatch(/not saved in this browser/);
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.click(screen.getByRole("button", { name: "Import / export" }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("keeps working and shows the banner when storage fills up during a save", () => {
    const backend = new MemoryBackend();
    backend.failWrites = "QuotaExceededError";
    const store = createStore(backend);
    renderApp(store);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(screen.getByRole("alert").textContent).toMatch(/not saved in this browser/);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("New run");
    expect(store.list().map((summary) => summary.name)).toEqual(["New run"]);
    expect(backend.items.size).toBe(0);
  });

  it("warns about stored runs it cannot read", () => {
    const backend = new MemoryBackend();
    backend.items.set("bg3p:run:bad", "{not json");
    renderApp(createStore(backend));
    expect(screen.getByRole("alert").textContent).toMatch(/1 stored run could not be read/);
  });

  it("sets the theme on the document element, system removes it", () => {
    renderApp();
    const theme = screen.getByRole("combobox", { name: "Theme" });
    fireEvent.change(theme, { target: { value: "dark" } });
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    fireEvent.change(theme, { target: { value: "system" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("routes by hash and hands a run link to the import flow", async () => {
    window.history.replaceState(null, "", "/#/transfer");
    renderApp();
    expect(screen.getByRole("button", { name: "Import / export" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Party" }));
    expect(window.location.hash).toBe("#/party");
    act(() => {
      window.history.replaceState(null, "", "/#BG3P2:abc");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/transfer");
    expect(within(screen.getByRole("main")).getByRole("textbox", { name: "Paste a run" })).toHaveProperty("value", "BG3P2:abc");
    expect(await within(screen.getByRole("main")).findByRole("alert")).toBeTruthy();
  });

  it("survives a malformed fragment", async () => {
    window.history.replaceState(null, "", "/#/character/%E0");
    renderApp();
    expect(screen.getByRole("button", { name: "Character" }).getAttribute("aria-current")).toBe("page");
    act(() => {
      window.history.replaceState(null, "", "/#BG3P%E0");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/transfer");
    expect(within(screen.getByRole("main")).getByRole("textbox", { name: "Paste a run" })).toHaveProperty("value", "BG3P%E0");
    expect(await within(screen.getByRole("main")).findByRole("alert")).toBeTruthy();
  });

  it("reloads the current run when another tab saves it", () => {
    const backend = new MemoryBackend();
    const store = createStore(backend);
    renderApp(store);
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const id = runSelector().value;
    const other = createStore(backend);
    other.save({ ...other.load(id)!, name: "Renamed in another tab" });
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: `bg3p:run:${id}` }));
    });
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Renamed in another tab");
    // A save here keeps the other tab's version in the history.
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Renamed here" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(createStore(backend).history(id).map((entry) => JSON.parse(entry.text).name)).toEqual(["Renamed here", "Renamed in another tab", "New run"]);
  });
});

describe("history panel", () => {
  it("is a tab of its own: no history button in the run bar, and #/history shows the list", () => {
    window.history.replaceState(null, "", "/#/history");
    const store = createStore(new MemoryBackend());
    store.save({ ...emptyRun("h1"), name: "Kept" });
    renderApp(store);
    expect(screen.getAllByRole("button", { name: "History" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "History" }).closest("nav")).not.toBeNull();
    expect(screen.getByRole("button", { name: "History" }).getAttribute("aria-current")).toBe("page");
    expect(within(screen.getByRole("main")).getByRole("list", { name: "Saved versions" })).toBeTruthy();
  });

  const rename = (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
  };
  const versions = () => within(screen.getByRole("list", { name: "Saved versions" })).getAllByRole("listitem");
  const restoreButtons = () => screen.getAllByRole("button", { name: /^Restore the version of / });

  it("lists the run's versions newest first and restores one after confirmation, itself undoable", () => {
    const { store } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    rename("Second");
    rename("Third");
    const id = runSelector().value;
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(versions()).toHaveLength(3);
    expect(versions()[0]!.textContent).toContain("current");
    expect(within(versions()[0]!).queryByRole("button")).toBeNull();
    expect(restoreButtons()).toHaveLength(2);

    fireEvent.click(restoreButtons()[1]!);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(store.history(id)).toHaveLength(3);

    fireEvent.click(restoreButtons()[1]!);
    expect(screen.getByText(/The current version stays in the history/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(runSelector().selectedOptions[0]?.textContent).toBe("New run");
    expect(store.load(id)?.name).toBe("New run");
    expect(versions()).toHaveLength(4);
    // Undo the restore: the version it replaced is the second one now.
    fireEvent.click(restoreButtons()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(store.load(id)?.name).toBe("Third");
  });

  it("keeps the version an import replaced reachable and restorable from the panel", async () => {
    const store = createStore(new MemoryBackend());
    const stored = store.save({ ...emptyRun("same"), name: "Stored" });
    renderApp(store);
    fireEvent.click(screen.getByRole("button", { name: "Import / export" }));
    const main = within(screen.getByRole("main"));
    fireEvent.change(main.getByRole("textbox", { name: "Paste a run" }), { target: { value: await encode({ ...stored, name: "Incoming", updatedAt: "2000-01-01T00:00:00.000Z" }) } });
    fireEvent.click(main.getByRole("button", { name: "Check" }));
    expect(await main.findByText("The stored version is newer than this one.")).toBeTruthy();
    fireEvent.click(main.getByRole("button", { name: "Replace" }));
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Incoming");

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(versions()).toHaveLength(2);
    fireEvent.click(restoreButtons()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    expect(store.load("same")?.name).toBe("Stored");
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Stored");
  });

  it("shows the restored version on the Import / export screen", async () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    rename("Later");
    fireEvent.click(screen.getByRole("button", { name: "Import / export" }));
    const json = () => (within(screen.getByRole("main")).getByRole("textbox", { name: "Readable JSON" }) as HTMLTextAreaElement).value;
    await waitFor(() => expect(json()).toContain('"Later"'));
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(restoreButtons()[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Restore this version" }));
    fireEvent.click(screen.getByRole("button", { name: "Import / export" }));
    await waitFor(() => expect(json()).toContain('"New run"'));
  });
});

describe("history panel: what each version changed", () => {
  const fighter = (classes: string[]): Character => ({
    id: "c1",
    who: "player",
    race: "Human",
    subrace: null,
    background: "Soldier",
    abilities: { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 },
    levels: classes.map((cls) => ({ class: cls, choices: {} })),
    items: [],
    notes: "",
  });
  const withSubclass = (subclass: string, extra: Partial<Run> = {}): Run => {
    const run = { ...emptyRun("h"), name: "Main", characters: [fighter(["Fighter", "Fighter", "Fighter"])], ...extra };
    run.characters[0]!.levels[2]!.choices = { "u/0": [subclass] };
    return run;
  };
  const frenchApp = (store: RunStore) => {
    const settings = new MemoryBackend();
    settings.items.set("bg3p:settings", JSON.stringify({ lang: "fr", currentRun: "h" }));
    window.history.replaceState(null, "", "/#/history");
    const data = stubData({}, { "class:Champion": text("Champion (fr)"), "class:BattleMaster": text("Maître de guerre (fr)"), "origin:Gale": text("Gale (fr)"), "origin:Astarion": text("Astarion (fr)") });
    render(<App data={data} store={store} settingsBackend={settings} />);
  };

  it("names the changed choice by its French name with the old one struck, and notes imports and restores", () => {
    const store = createStore(new MemoryBackend());
    store.save(withSubclass("Champion"));
    store.save(withSubclass("BattleMaster"));
    store.save(withSubclass("BattleMaster"), { note: { kind: "import" } });
    const atFirst = store.history("h")[2]!.at;
    store.restore("h", atFirst);
    frenchApp(store);
    const items = within(screen.getByRole("list", { name: "Versions enregistrées" })).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]!.textContent).toContain("Restauration de la version du ");
    expect(items[0]!.textContent).toContain("version actuelle");
    expect(items[1]!.textContent).toContain("Import");
    const line = items[0]!.querySelector(".diffline")!;
    expect(line.textContent).toContain("Joueur");
    expect(line.textContent).toContain("Champion (fr)");
    expect(line.querySelector("s.was")?.textContent).toBe("Maître de guerre (fr)");
    expect(items[2]!.querySelector("s.was")?.textContent).toBe("Champion (fr)");
    expect(items[3]!.textContent).toContain("Première version");
    expect(items[3]!.querySelector(".diffline")).toBeNull();
  });

  it("shows the first two changes and folds the others under '+N autres'", () => {
    const store = createStore(new MemoryBackend());
    const before = withSubclass("Champion");
    store.save(before);
    const after = withSubclass("BattleMaster", { name: "Renamed" });
    after.party["2"].active = ["Gale"];
    after.party["3"].active = ["Astarion"];
    store.save(after);
    frenchApp(store);
    const newest = within(screen.getByRole("list", { name: "Versions enregistrées" })).getAllByRole("listitem")[0]!;
    const details = newest.querySelector("details")!;
    expect(details.querySelector("summary")?.textContent).toBe("+2 autres");
    expect(newest.querySelectorAll(".what > .diffline")).toHaveLength(2);
    expect(details.querySelectorAll(".diffline")).toHaveLength(2);
    expect(details.hasAttribute("open")).toBe(false);
    fireEvent.click(details.querySelector("summary")!);
    expect(details.hasAttribute("open")).toBe(true);
    expect(newest.textContent).toContain("Groupe · acte 3");
    expect(newest.textContent).toContain("Astarion (fr)");
  });

  it("keeps the prefix of a swap with no new value, labels a removed-only party change, and says so for other or unreadable differences", () => {
    const store = createStore(new MemoryBackend());
    const first = withSubclass("Champion");
    first.party["2"].active = ["Gale"];
    store.save(first);
    const second = withSubclass("Champion");
    second.party["2"].active = [];
    second.characters[0]!.levels[2]!.choices = {};
    store.save(second);
    const third = { ...second, bonuses: ["SomeBonus"] };
    store.save(third);
    frenchApp(store);
    const items = within(screen.getByRole("list", { name: "Versions enregistrées" })).getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("Autres changements");
    expect(items[1]!.textContent).toContain("Groupe · acte 2");
    expect(items[1]!.textContent).toContain("personne n’arrive");
    expect(items[1]!.querySelector("s.was")?.textContent).toContain("Gale (fr)");
    expect(items[1]!.textContent).toContain("Niveau 3 : aucun");
  });

  it("says the previous version could not be read instead of claiming no change", () => {
    const backend = new MemoryBackend();
    const run = { ...withSubclass("Champion"), updatedAt: "2026-11-24T11:00:00.000Z" };
    backend.items.set("bg3p:run:h", JSON.stringify({ history: [{ at: "2026-11-24T11:00:00.000Z", text: JSON.stringify(run) }, { at: "2026-11-24T10:00:00.000Z", text: "not json" }] }));
    frenchApp(createStore(backend));
    const newest = within(screen.getByRole("list", { name: "Versions enregistrées" })).getAllByRole("listitem")[0]!;
    expect(newest.textContent).toContain("La version précédente n’a pas pu être lue");
    expect(newest.textContent).not.toContain("Aucun changement");
  });

  it("describes versions saved by the previous site: version-2 JSON without a note", () => {
    const backend = new MemoryBackend();
    const strip = (run: Run, at: string) => {
      const { difficulty: _difficulty, ...rest } = { ...run, updatedAt: at };
      return { at, text: JSON.stringify({ ...rest, version: 2, difficulty: "Balanced" }) };
    };
    const history = [strip(withSubclass("BattleMaster"), "2026-11-24T11:00:00.000Z"), strip(withSubclass("Champion"), "2026-11-24T10:00:00.000Z")];
    backend.items.set("bg3p:run:h", JSON.stringify({ history }));
    frenchApp(createStore(backend));
    const newest = within(screen.getByRole("list", { name: "Versions enregistrées" })).getAllByRole("listitem")[0]!;
    expect(newest.querySelector("s.was")?.textContent).toBe("Champion (fr)");
    expect(newest.textContent).toContain("Maître de guerre (fr)");
  });
});

