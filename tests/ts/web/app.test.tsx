import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { validate } from "../../../src/engine/validate.ts";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Character, Run } from "../../../src/plan/model.ts";
import App from "../../../web/src/App.tsx";
import { HISTORY_LIMIT, createStore } from "../../../web/src/state/storage.ts";
import type { RunStore } from "../../../web/src/state/storage.ts";
import { runAction, setLanguage, setTheme } from "./header.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { StreamingBlob } from "./streamingBlob.ts";
import { realData } from "./realData.ts";
import { stubData, text } from "./stubData.ts";

beforeAll(() => {
  vi.stubGlobal("Blob", StreamingBlob);
});

function renderApp(store: RunStore = createStore(new MemoryBackend()), settings = new MemoryBackend()) {
  render(<App data={stubData()} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
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
  it("the header holds the brand, the four screens, the run selector, the run menu and the settings menu", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    const header = screen.getByRole("banner");
    expect(header.querySelector(".brand")?.textContent).toBe("BG3 Planner");
    expect(header.querySelector(".brand b")?.textContent).toBe("BG3");
    expect(within(within(header).getByRole("navigation")).getAllByRole("button").map((b) => b.textContent)).toEqual(["Party", "Character", "History", "Import / export"]);
    expect(within(header).getByRole("combobox", { name: "Run" })).toBeTruthy();
    expect(within(header).getByRole("button", { name: "Run actions" }).getAttribute("aria-haspopup")).toBe("menu");
    expect(within(header).getByRole("button", { name: "Settings" }).getAttribute("aria-haspopup")).toBe("menu");
    // Only the two menu buttons, the tabs and the run select: language and theme live in the settings menu.
    expect(within(header).queryByRole("combobox", { name: "Language" })).toBeNull();
    runAction("Duplicate");
    expect(within(within(header).getByRole("combobox", { name: "Run" })).getAllByRole("option")).toHaveLength(2);
    fireEvent.click(within(header).getByRole("button", { name: "Settings" }));
    expect(within(header).getByRole("combobox", { name: "Language" })).toBeTruthy();
    expect(within(header).getByRole("combobox", { name: "Theme" })).toBeTruthy();
  });

  it("with no run the header shows a visible Nouvelle partie button and no run menu", () => {
    window.history.replaceState(null, "", "/");
    const settings = new MemoryBackend();
    settings.items.set("bg3p:settings", JSON.stringify({ lang: "fr" }));
    renderApp(createStore(new MemoryBackend()), settings);
    expect(screen.getByRole("button", { name: "Nouvelle partie" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Actions sur la partie" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Partie" })).toBeNull();
    expect(screen.getByRole("button", { name: "Réglages" })).toBeTruthy();
  });

  it("Renommer from the run menu opens the rename field and Supprimer the confirmation bar", () => {
    const { store } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    runAction("Rename");
    expect(screen.getByRole("textbox", { name: "Run name" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    runAction("Delete");
    expect(screen.getByText("Delete “New run” and its history from this browser?")).toBeTruthy();
    expect(store.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(store.list()).toHaveLength(0);
  });

  it("a run action gives the focus back to the run menu button, and a language or theme choice closes the settings menu on its button", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    runAction("Duplicate");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Run actions" }));
    expect(screen.queryByRole("menu")).toBeNull();
    setTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Settings" }));
    setLanguage("fr");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Réglages" }));
  });

  it("the difficulty is not in the header", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(within(screen.getByRole("banner")).queryByRole("combobox", { name: /Difficult/ })).toBeNull();
    expect(within(screen.getByRole("main")).getByRole("combobox", { name: /Difficult/ })).toBeTruthy();
  });

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

    runAction("Rename");
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Dark urges" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");

    runAction("Duplicate");
    expect(store.list().map((summary) => summary.name).sort()).toEqual(["Dark urges", "Dark urges (copy)"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges (copy)");

    runAction("Delete");
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(store.list().map((summary) => summary.name)).toEqual(["Dark urges"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");
  });

  it("switches language without losing the run", () => {
    const { store } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    runAction("Rename");
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "My run" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    const id = runSelector().value;

    setLanguage("fr");
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
    setTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    setTheme("system");
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
    runAction("Rename");
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
    runAction("Rename");
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
    equipment: { "1": {}, "2": {}, "3": {} },
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
    render(<App data={data} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
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

describe("history panel: new values, separators and the kept window (English, game data)", () => {
  const player = (abilities: Character["abilities"]): Character => ({ id: "c1", who: "player", race: "Human", subrace: null, background: "", abilities, levels: [{ class: "Fighter", choices: {} }], equipment: { "1": {}, "2": {}, "3": {} }, notes: "" });
  const SCORES = { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 };
  const englishApp = (store: RunStore) => {
    window.history.replaceState(null, "", "/#/history");
    render(<App data={realData()} store={store} settingsBackend={new MemoryBackend()} sessionBackend={new MemoryBackend()} />);
    return within(screen.getByRole("list", { name: "Saved versions" })).getAllByRole("listitem");
  };

  it("shows a rename with the new name and the old one struck", () => {
    const store = createStore(new MemoryBackend());
    store.save({ ...emptyRun("n"), name: "Main" });
    store.save({ ...emptyRun("n"), name: "Dark urges" });
    const line = englishApp(store)[0]!.querySelector(".diffline")!;
    expect(line.textContent).toContain("Dark urges");
    expect(line.querySelector("s.was")?.textContent).toBe("Main");
  });

  it("shows the changed ability scores under the game's ability names, the old ones struck", () => {
    const store = createStore(new MemoryBackend());
    store.save({ ...emptyRun("a"), characters: [player(SCORES)] });
    store.save({ ...emptyRun("a"), characters: [player({ ...SCORES, Strength: 10, Dexterity: 14 })] });
    const line = englishApp(store)[0]!.querySelector(".diffline")!;
    const was = line.querySelector("s.was")!;
    expect(was.textContent).toBe("Strength 8, Dexterity 15");
    expect(line.textContent!.replace(was.textContent!, "")).toContain("Strength 10, Dexterity 14");
  });

  it("separates the subject and a choice's level with the English separator", () => {
    const store = createStore(new MemoryBackend());
    const run = (picks: string[]) => {
      const r = { ...emptyRun("s"), characters: [player(SCORES)] };
      r.characters[0]!.levels[0]!.choices = { "u/1": picks };
      return r;
    };
    store.save(run(["A", "B"]));
    store.save(run(["C", "D"]));
    const line = englishApp(store)[0]!.querySelector(".diffline")!;
    expect(line.textContent).toMatch(/^Player: Level 1: \+ /);
    expect(line.textContent).not.toContain(" : ");
  });

  it("says older versions are no longer kept on the oldest kept version once the history is full", () => {
    const store = createStore(new MemoryBackend());
    for (let i = 0; i <= HISTORY_LIMIT; i++) store.save({ ...emptyRun("cap"), name: `Name ${i}` });
    expect(store.history("cap")).toHaveLength(HISTORY_LIMIT);
    const items = englishApp(store);
    expect(items).toHaveLength(HISTORY_LIMIT);
    expect(items[HISTORY_LIMIT - 1]!.textContent).toContain("Older versions are no longer kept");
    expect(items[HISTORY_LIMIT - 1]!.textContent).not.toContain("First saved version");
  });

  it("still calls the oldest version the first one while the history is not full", () => {
    const store = createStore(new MemoryBackend());
    store.save({ ...emptyRun("few"), name: "One" });
    store.save({ ...emptyRun("few"), name: "Two" });
    const items = englishApp(store);
    expect(items[1]!.textContent).toContain("First saved version");
  });
});

describe("difficulty picker", () => {
  const data = () => realData();
  const renderRun = (run: Run, lang: "en" | "fr" = "fr") => {
    const store = createStore(new MemoryBackend());
    const saved = store.save(run);
    const settings = new MemoryBackend();
    settings.items.set("bg3p:settings", JSON.stringify({ lang }));
    render(<App data={data()} store={store} settingsBackend={settings} sessionBackend={new MemoryBackend()} />);
    return { store, id: saved.id };
  };
  const picker = () => screen.getByRole("combobox", { name: /^Difficult/ }) as HTMLSelectElement;
  const optionNames = () => Array.from(picker().options).map((o) => o.textContent);

  it("offers the game's rulesets in order, Custom Mode last, and saves a preset with its effect pills", () => {
    const { store, id } = renderRun({ ...emptyRun("d1"), difficulty: { ruleset: "DIFFICULTY_MEDIUM", overrides: { MULTICLASSING: false } } });
    expect(optionNames()).toEqual(["Explorateur", "Équilibré", "Tacticien", "Règles du mode Honneur", "Mode Personnalisé"]);
    expect(picker().value).toBe("DIFFICULTY_MEDIUM");
    fireEvent.change(picker(), { target: { value: "DIFFICULTY_EASY" } });
    expect(store.load(id)!.difficulty).toEqual({ ruleset: "DIFFICULTY_EASY", overrides: {} });
    expect(screen.getByText("Multiclassage désactivé")).toBeTruthy();
    expect(screen.getByText("+2 au bonus de maîtrise")).toBeTruthy();
    fireEvent.change(picker(), { target: { value: "RULESET_HONOUR" } });
    expect(screen.getByText("Statistiques du mode Honneur : certains sorts et objets changent")).toBeTruthy();
    expect(screen.queryByText("Multiclassage désactivé")).toBeNull();
  });

  it("shows an empty first option for an undecided difficulty", () => {
    const { store, id } = renderRun(emptyRun("d2"));
    expect(optionNames()[0]).toBe("Difficulté à choisir");
    expect(picker().value).toBe("");
    fireEvent.change(picker(), { target: { value: "DIFFICULTY_HARD" } });
    expect(store.load(id)!.difficulty.ruleset).toBe("DIFFICULTY_HARD");
    expect(optionNames()).not.toContain("Difficulté à choisir");
  });

  it("edits the custom modifiers in the overrides, bounded by the game's range", () => {
    const { store, id } = renderRun({ ...emptyRun("d3"), difficulty: { ruleset: "DIFFICULTY_EASY", overrides: {} } });
    expect(screen.queryByRole("checkbox", { name: "Multiclassage" })).toBeNull();
    fireEvent.change(picker(), { target: { value: "RULESET_LARIAN" } });
    expect(store.load(id)!.difficulty).toEqual({ ruleset: "RULESET_LARIAN", overrides: {} });
    expect(optionNames()).not.toContain("Règles classiques");
    expect(picker().selectedOptions[0]!.textContent).toBe("Mode Personnalisé");
    const box = screen.getByRole("checkbox", { name: "Multiclassage" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.closest("label")!.title).toBe("Permet de choisir une autre classe lorsque vous gagnez un niveau.");
    fireEvent.click(box);
    expect(store.load(id)!.difficulty.overrides).toEqual({ MULTICLASSING: false });
    const bonus = screen.getByRole("spinbutton", { name: "Bonus de maîtrise" }) as HTMLInputElement;
    const modifier = data().rules.rulesetModifiers.PROFICIENCY_BONUS;
    expect(bonus.min).toBe(String(modifier.min));
    expect(bonus.max).toBe(String(modifier.max));
    fireEvent.change(bonus, { target: { value: "3" } });
    expect(store.load(id)!.difficulty.overrides).toEqual({ MULTICLASSING: false, PROFICIENCY_BONUS: 3 });
    fireEvent.change(bonus, { target: { value: String(modifier.max! + 1) } });
    expect(store.load(id)!.difficulty.overrides).toEqual({ MULTICLASSING: false, PROFICIENCY_BONUS: 3 });
    expect(screen.getByText("+3 au bonus de maîtrise")).toBeTruthy();
  });

  it("lets the proficiency bonus be typed through an empty or out-of-range value, saving only valid values and reverting on blur", () => {
    const { store, id } = renderRun({ ...emptyRun("d8"), difficulty: { ruleset: "RULESET_LARIAN", overrides: { PROFICIENCY_BONUS: 2 } } });
    const bonus = screen.getByRole("spinbutton", { name: "Bonus de maîtrise" }) as HTMLInputElement;
    const max = data().rules.rulesetModifiers.PROFICIENCY_BONUS.max!;
    expect(bonus.value).toBe("2");
    const versions = store.history(id).length;
    // Typing "3" over "2": the field goes through an empty value first.
    fireEvent.change(bonus, { target: { value: "" } });
    expect(bonus.value).toBe("");
    expect(store.load(id)!.difficulty.overrides).toEqual({ PROFICIENCY_BONUS: 2 });
    fireEvent.change(bonus, { target: { value: "3" } });
    expect(bonus.value).toBe("3");
    expect(store.load(id)!.difficulty.overrides).toEqual({ PROFICIENCY_BONUS: 3 });
    expect(store.history(id).length).toBe(versions + 1);
    // An out-of-range value stays in the field while typing, is never saved, and gives way to the saved value on blur.
    fireEvent.change(bonus, { target: { value: String(max + 1) } });
    expect(bonus.value).toBe(String(max + 1));
    expect(store.load(id)!.difficulty.overrides).toEqual({ PROFICIENCY_BONUS: 3 });
    fireEvent.blur(bonus);
    expect(bonus.value).toBe("3");
    expect(store.history(id).length).toBe(versions + 1);
  });

  it("saves one history version per difficulty change", () => {
    const { store, id } = renderRun({ ...emptyRun("d6"), difficulty: { ruleset: "DIFFICULTY_MEDIUM", overrides: {} } });
    const before = store.history(id).length;
    fireEvent.change(picker(), { target: { value: "DIFFICULTY_EASY" } });
    expect(store.history(id).length).toBe(before + 1);
    fireEvent.change(picker(), { target: { value: "RULESET_LARIAN" } });
    expect(store.history(id).length).toBe(before + 2);
    fireEvent.click(screen.getByRole("checkbox", { name: "Multiclassage" }));
    expect(store.history(id).length).toBe(before + 3);
  });

  it("drops an override that equals what the ruleset gives", () => {
    const { store, id } = renderRun({ ...emptyRun("d7"), difficulty: { ruleset: "RULESET_LARIAN", overrides: {} } });
    const box = screen.getByRole("checkbox", { name: "Multiclassage" });
    fireEvent.click(box);
    expect(store.load(id)!.difficulty.overrides).toEqual({ MULTICLASSING: false });
    fireEvent.click(box);
    expect(store.load(id)!.difficulty.overrides).toEqual({});
    const bonus = screen.getByRole("spinbutton", { name: "Bonus de maîtrise" });
    fireEvent.change(bonus, { target: { value: "2" } });
    expect(store.load(id)!.difficulty.overrides).toEqual({ PROFICIENCY_BONUS: 2 });
    fireEvent.change(bonus, { target: { value: "0" } });
    expect(store.load(id)!.difficulty.overrides).toEqual({});
  });

  it("keeps an unknown ruleset and says so", () => {
    const { store, id } = renderRun({ ...emptyRun("d4"), difficulty: { ruleset: "Nightmare", overrides: {} } });
    expect(screen.getByText("Difficulté inconnue : Nightmare")).toBeTruthy();
    expect(picker().value).toBe("Nightmare");
    expect(store.load(id)!.difficulty.ruleset).toBe("Nightmare");
  });

  it("flags then clears the multiclass levels when the difficulty goes to Explorer and back, removing no pick", () => {
    const d = data();
    const levels = ["Ranger", "Rogue", "Rogue"].map((cls) => ({ class: cls, choices: {} }));
    const run: Run = {
      ...emptyRun("d5"),
      difficulty: { ruleset: "DIFFICULTY_MEDIUM", overrides: {} },
      characters: [{ id: "p", who: "player", race: "Halfling", subrace: "Halfling_Lightfoot", background: Object.keys(d.rules.backgrounds)[0]!, abilities: { Strength: 8, Dexterity: 15, Constitution: 14, Intelligence: 8, Wisdom: 15, Charisma: 10 }, levels, equipment: { "1": {}, "2": {}, "3": {} }, notes: "" }],
    };
    run.party["1"].active = ["p"];
    const { store, id } = renderRun(run, "en");
    const flagged = () => validate(store.load(id)!, d).issues.filter((issue) => issue.code === "multiclassDisabled").map((issue) => issue.level);
    expect(flagged()).toEqual([]);
    fireEvent.change(picker(), { target: { value: "DIFFICULTY_EASY" } });
    expect(flagged()).toEqual([2, 3]);
    expect(store.load(id)!.characters[0]!.levels.map((l) => l.class)).toEqual(["Ranger", "Rogue", "Rogue"]);
    fireEvent.change(picker(), { target: { value: "DIFFICULTY_MEDIUM" } });
    expect(flagged()).toEqual([]);
    expect(store.load(id)!.characters[0]!.levels.map((l) => l.class)).toEqual(["Ranger", "Rogue", "Rogue"]);
  });

  it("does not show the picker without a run", () => {
    renderApp();
    expect(screen.queryByRole("combobox", { name: /^Difficult/ })).toBeNull();
  });
});
