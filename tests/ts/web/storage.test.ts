import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJson } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { loadSettings, saveSettings } from "../../../web/src/state/settings.ts";
import { MemoryBackend } from "./memoryBackend.ts";

function named(name: string, id = "run-1"): Run {
  const run = emptyRun(id);
  run.name = name;
  return run;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("run store", () => {
  it("saves, loads and lists runs, newest first, under the bg3p keys", () => {
    vi.useFakeTimers();
    const backend = new MemoryBackend();
    const store = createStore(backend);
    expect(store.available).toBe(true);
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    store.save(named("First", "a"));
    vi.setSystemTime(new Date("2026-11-25T11:00:00.000Z"));
    store.save(named("Second", "b"));

    expect(store.load("a")).toEqual({ ...named("First", "a"), updatedAt: "2026-11-25T10:00:00.000Z" });
    expect(store.list()).toEqual([
      { id: "b", name: "Second", updatedAt: "2026-11-25T11:00:00.000Z" },
      { id: "a", name: "First", updatedAt: "2026-11-25T10:00:00.000Z" },
    ]);
    expect(backend.items.has("bg3p:index")).toBe(true);
    expect(backend.items.has("bg3p:run:a")).toBe(true);
    expect(store.load("missing")).toBeNull();

    const reopened = createStore(backend);
    expect(reopened.list()).toEqual(store.list());
    expect(reopened.load("b")?.name).toBe("Second");
  });

  it("does not share objects with the caller", () => {
    const store = createStore(new MemoryBackend());
    const run = named("Mine");
    store.save(run);
    run.name = "Changed after saving";
    const loaded = store.load(run.id)!;
    loaded.name = "Changed after loading";
    expect(store.load(run.id)?.name).toBe("Mine");
  });

  it("keeps the 20 most recent versions, newest first, as the run's JSON", () => {
    const store = createStore(new MemoryBackend());
    for (let i = 0; i < 25; i++) store.save(named(`v${i}`));
    const history = store.history("run-1");
    expect(history).toHaveLength(20);
    expect(history.map((entry) => decodeJson(entry.text).name)).toEqual(Array.from({ length: 20 }, (_, i) => `v${24 - i}`));
    expect(new Set(history.map((entry) => entry.at)).size).toBe(20);
    expect(history[0]?.at).toBe(store.load("run-1")?.updatedAt);
  });

  it("makes updatedAt strictly increasing for saves within the same millisecond", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    const store = createStore(new MemoryBackend());
    store.save(named("A"));
    store.save(named("B"));
    expect(store.history("run-1").map((entry) => entry.at)).toEqual(["2026-11-25T10:00:00.001Z", "2026-11-25T10:00:00.000Z"]);
  });

  it("restores a version as the current one and keeps the replaced one in history", () => {
    const store = createStore(new MemoryBackend());
    store.save(named("A"));
    store.save(named("B"));
    const atA = store.history("run-1")[1]!.at;
    const restored = store.restore("run-1", atA);
    expect(restored.name).toBe("A");
    expect(store.load("run-1")?.name).toBe("A");
    expect(store.history("run-1").map((entry) => decodeJson(entry.text).name)).toEqual(["A", "B", "A"]);
    expect(() => store.restore("run-1", "1999-01-01T00:00:00.000Z")).toThrow();
  });

  it("removes a run and its history", () => {
    const backend = new MemoryBackend();
    const store = createStore(backend);
    store.save(named("Gone"));
    store.remove("run-1");
    expect(store.list()).toEqual([]);
    expect(store.load("run-1")).toBeNull();
    expect(store.history("run-1")).toEqual([]);
    expect(backend.items.has("bg3p:run:run-1")).toBe(false);
  });

  it("gives a run with an empty id a UUID when first saved", () => {
    const store = createStore(new MemoryBackend());
    const saved = store.save(named("Imported", ""));
    expect(saved.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(store.load(saved.id)?.name).toBe("Imported");
    expect(store.list().map((summary) => summary.id)).toEqual([saved.id]);
  });

  it("works in memory without a backend", () => {
    const store = createStore(null);
    expect(store.available).toBe(false);
    store.save(named("Volatile"));
    expect(store.load("run-1")?.name).toBe("Volatile");
    expect(store.list()).toHaveLength(1);
  });

  it("switches to memory when a write hits the quota, and keeps working", () => {
    const backend = new MemoryBackend();
    const store = createStore(backend);
    store.save(named("Stored"));
    backend.failWrites = "QuotaExceededError";
    store.save(named("Too big", "run-2"));
    expect(store.available).toBe(false);
    expect(store.load("run-2")?.name).toBe("Too big");
    expect(store.list().map((summary) => summary.id).sort()).toEqual(["run-1", "run-2"]);
    store.remove("run-1");
    expect(store.load("run-1")).toBeNull();
  });

  it("switches to memory when the backend refuses to be read", () => {
    const backend = new MemoryBackend();
    backend.failReads = "SecurityError";
    const store = createStore(backend);
    expect(store.available).toBe(false);
    store.save(named("Volatile"));
    expect(store.load("run-1")?.name).toBe("Volatile");
  });

  it("skips an unreadable stored run, reports it and never deletes it", () => {
    const backend = new MemoryBackend();
    createStore(backend).save(named("Good", "good"));
    backend.items.set("bg3p:run:bad", "{not json");
    backend.items.set("bg3p:run:old", JSON.stringify({ history: [{ at: "2026-11-25T10:00:00.000Z", text: JSON.stringify({ version: 2 }) }] }));
    const store = createStore(backend);
    expect(store.list().map((summary) => summary.id)).toEqual(["good"]);
    expect(store.load("bad")).toBeNull();
    expect(store.load("old")).toBeNull();
    expect(store.unreadable().map((entry) => entry.id).sort()).toEqual(["bad", "old"]);
    expect(store.unreadable().every((entry) => entry.message !== "")).toBe(true);
    store.save(named("Another", "another"));
    store.remove("good");
    expect(backend.items.get("bg3p:run:bad")).toBe("{not json");
    expect(backend.items.has("bg3p:run:old")).toBe(true);
  });
  it("treats a stored version whose date is not a date as unreadable, and keeps it", () => {
    const backend = new MemoryBackend();
    const record = JSON.stringify({ history: [{ at: "yesterday", text: JSON.stringify(named("Dated")) }] });
    backend.items.set("bg3p:run:run-1", record);
    const store = createStore(backend);
    expect(store.load("run-1")).toBeNull();
    expect(store.unreadable().map((entry) => entry.id)).toEqual(["run-1"]);
    expect(() => store.save(named("Again"))).toThrow(/run-1/);
    expect(backend.items.get("bg3p:run:run-1")).toBe(record);
  });

  it("refuses to save over an unreadable stored run and leaves it byte for byte", () => {
    const backend = new MemoryBackend();
    backend.items.set("bg3p:run:bad", "{not json");
    const store = createStore(backend);
    expect(() => store.save(named("Over it", "bad"))).toThrow(/bad/);
    expect(backend.items.get("bg3p:run:bad")).toBe("{not json");
    expect(store.load("bad")).toBeNull();
    expect(store.list()).toEqual([]);
  });
});

describe("run store: dates kept on import", () => {
  it("keeps an imported run's own edit date while its history time still increases", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    const store = createStore(new MemoryBackend());
    store.save(named("Local"));
    vi.setSystemTime(new Date("2026-11-25T12:00:00.000Z"));
    const imported = store.save({ ...named("Imported"), updatedAt: "2026-11-25T08:00:00.000Z" }, { keepDate: true });
    expect(imported.updatedAt).toBe("2026-11-25T08:00:00.000Z");
    expect(store.load("run-1")?.updatedAt).toBe("2026-11-25T08:00:00.000Z");
    expect(store.list()[0]?.updatedAt).toBe("2026-11-25T08:00:00.000Z");
    expect(store.history("run-1").map((entry) => entry.at)).toEqual(["2026-11-25T12:00:00.000Z", "2026-11-25T10:00:00.000Z"]);
  });

  it("stamps a real edit after both the newest version and an imported date from a clock that ran ahead", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    const store = createStore(new MemoryBackend());
    store.save({ ...named("Ahead"), updatedAt: "2026-11-26T00:00:00.000Z" }, { keepDate: true });
    const edited = store.save(named("Edited"));
    expect(Date.parse(edited.updatedAt!)).toBeGreaterThan(Date.parse("2026-11-26T00:00:00.000Z"));
    expect(store.history("run-1")[0]?.at).toBe(edited.updatedAt);
  });

  it("stamps an imported run that has no edit date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T10:00:00.000Z"));
    const store = createStore(new MemoryBackend());
    expect(store.save(named("Migrated"), { keepDate: true }).updatedAt).toBe("2026-11-25T10:00:00.000Z");
  });
});

describe("run store: two tabs on the same storage", () => {
  it("never drops the other tab's versions when a stale tab saves", () => {
    const backend = new MemoryBackend();
    const first = createStore(backend);
    first.save(named("Start"));
    const second = createStore(backend);
    first.save(named("Edited in the first tab"));
    second.save(named("Edited in the stale tab"));
    const names = (store: ReturnType<typeof createStore>) => store.history("run-1").map((entry) => decodeJson(entry.text).name);
    expect(names(second)).toEqual(["Edited in the stale tab", "Edited in the first tab", "Start"]);
    expect(names(createStore(backend))).toEqual(["Edited in the stale tab", "Edited in the first tab", "Start"]);
    const ats = second.history("run-1").map((entry) => entry.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(new Set(ats).size).toBe(3);
  });

  it("merges the other tab's versions before a restore too", () => {
    const backend = new MemoryBackend();
    const first = createStore(backend);
    first.save(named("Start"));
    const second = createStore(backend);
    first.save(named("Edited in the first tab"));
    second.restore("run-1", second.history("run-1")[0]!.at);
    expect(createStore(backend).history("run-1").map((entry) => decodeJson(entry.text).name)).toEqual(["Start", "Edited in the first tab", "Start"]);
  });

  it("refresh reads the runs another tab added, changed or removed", () => {
    const backend = new MemoryBackend();
    const first = createStore(backend);
    first.save(named("Kept", "kept"));
    first.save(named("Gone", "gone"));
    const second = createStore(backend);
    first.save(named("Kept, renamed", "kept"));
    first.save(named("New", "new"));
    first.remove("gone");
    second.refresh();
    expect(second.list().map((summary) => summary.name).sort()).toEqual(["Kept, renamed", "New"]);
    expect(second.load("kept")?.name).toBe("Kept, renamed");
    expect(second.history("kept")).toHaveLength(2);
    expect(second.load("gone")).toBeNull();
  });
});

describe("settings", () => {
  it("default the language from the browser and the rest to system, list view, no run", () => {
    expect(loadSettings(null, "fr-CA")).toEqual({ lang: "fr", theme: "system", tree: false, currentRun: null });
    expect(loadSettings(null, "de-DE").lang).toBe("en");
    expect(loadSettings(null, "en-US").lang).toBe("en");
  });

  it("are kept under bg3p:settings and ignore bad stored values", () => {
    const backend = new MemoryBackend();
    saveSettings(backend, { lang: "fr", theme: "dark", tree: true, currentRun: "abc" });
    expect(JSON.parse(backend.items.get("bg3p:settings")!)).toEqual({ lang: "fr", theme: "dark", tree: true, currentRun: "abc" });
    expect(loadSettings(backend, "en-US")).toEqual({ lang: "fr", theme: "dark", tree: true, currentRun: "abc" });
    backend.items.set("bg3p:settings", JSON.stringify({ lang: "de", theme: "neon", tree: "yes", currentRun: 3 }));
    expect(loadSettings(backend, "en-US")).toEqual({ lang: "en", theme: "system", tree: false, currentRun: null });
    backend.items.set("bg3p:settings", "{oops");
    expect(loadSettings(backend, "fr")).toEqual({ lang: "fr", theme: "system", tree: false, currentRun: null });
  });

  it("never throw when the backend fails", () => {
    const backend = new MemoryBackend();
    backend.failReads = "SecurityError";
    backend.failWrites = "QuotaExceededError";
    expect(loadSettings(backend, "fr").lang).toBe("fr");
    expect(() => saveSettings(backend, { lang: "en", theme: "light", tree: false, currentRun: null })).not.toThrow();
  });
});
