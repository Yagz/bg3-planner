import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import Transfer from "../../../web/src/screens/Transfer.tsx";
import { createStore } from "../../../web/src/state/storage.ts";
import type { RunStore } from "../../../web/src/state/storage.ts";
import { v1String } from "./v1Run.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { StreamingBlob } from "./streamingBlob.ts";
import { stubData } from "./stubData.ts";

beforeAll(() => {
  vi.stubGlobal("Blob", StreamingBlob);
});

afterEach(cleanup);

function badRun(name: string): Run {
  const run = emptyRun("same");
  run.name = name;
  run.characters.push({
    id: "c1",
    who: "player",
    race: "Race_X",
    subrace: null,
    background: "Bg_X",
    abilities: { Strength: 8, Dexterity: 8, Constitution: 8, Intelligence: 8, Wisdom: 8, Charisma: 8 },
    levels: [],
    items: [],
    notes: "",
  });
  return run;
}

function renderTransfer(store: RunStore, run: Run | null = null, onImported = vi.fn()) {
  render(<Transfer data={stubData()} store={store} run={run} onImported={onImported} />);
  return onImported;
}

async function paste(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Paste a run" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Check" }));
}

describe("Transfer", () => {
  it("lists the engine's refusals choice by choice and saves nothing before the user decides", async () => {
    const store = createStore(new MemoryBackend());
    renderTransfer(store);
    await paste(await encode(badRun("Incoming")));
    expect(await screen.findByText("Unknown race: Race_X.")).toBeTruthy();
    expect(screen.getByText("Unknown background: Bg_X.")).toBeTruthy();
    expect(store.list()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(store.list().map((s) => s.name)).toEqual(["Incoming"]);
  });

  it("shows an unreadable paste as an error", async () => {
    renderTransfer(createStore(new MemoryBackend()));
    await paste("garbage");
    expect((await screen.findByRole("alert")).textContent?.length).toBeGreaterThan(0);
  });

  it("asks before an older version replaces a newer one; keep leaves the store unchanged", async () => {
    const store = createStore(new MemoryBackend());
    const stored = store.save(badRun("Stored"));
    const onImported = renderTransfer(store);
    await paste(await encode({ ...badRun("Incoming"), updatedAt: "2000-01-01T00:00:00.000Z" }));
    expect(await screen.findByText("The stored version is newer than this one.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep the stored version" }));
    expect(store.load(stored.id)?.name).toBe("Stored");
    expect(store.history(stored.id)).toHaveLength(1);
    expect(onImported).not.toHaveBeenCalled();
    expect(screen.queryByText("The stored version is newer than this one.")).toBeNull();
  });

  it("replace puts the previous version in history; copy adds a second run", async () => {
    const store = createStore(new MemoryBackend());
    store.save(badRun("Stored"));
    const onImported = renderTransfer(store);
    await paste(await encode({ ...badRun("Incoming"), updatedAt: "2000-01-01T00:00:00.000Z" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    expect(store.load("same")?.name).toBe("Incoming");
    expect(store.history("same").map((h) => JSON.parse(h.text).name)).toEqual(["Incoming", "Stored"]);
    expect(onImported).toHaveBeenCalledWith("same");

    await paste(await encode({ ...badRun("Third"), updatedAt: "2000-01-01T00:00:00.000Z" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import as a copy" }));
    expect(store.list().map((s) => s.name).sort()).toEqual(["Incoming", "Third"]);
  });

  it("imports a link handed over by the app, without a paste", async () => {
    const store = createStore(new MemoryBackend());
    const string = await encode(badRun("From link"));
    render(<Transfer data={stubData()} store={store} run={null} initialText={string} onImported={vi.fn()} />);
    expect(await screen.findByText("Unknown race: Race_X.")).toBeTruthy();
  });

  it("exports the current run as a string, readable JSON and a link, each with a copy button", async () => {
    const store = createStore(new MemoryBackend());
    const saved = store.save(badRun("Mine"));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderTransfer(store, store.load(saved.id));
    const string = await encode(store.load(saved.id)!);
    const linkBox = (await screen.findByRole("textbox", { name: "Link" })) as HTMLTextAreaElement;
    expect(linkBox.value).toBe(`${window.location.origin}/#${string}`);
    expect((screen.getByRole("textbox", { name: "Export string" }) as HTMLTextAreaElement).value).toBe(string);
    expect((screen.getByRole("textbox", { name: "Readable JSON" }) as HTMLTextAreaElement).value).toContain('"name": "Mine"');
    const panel = linkBox.closest("section")!;
    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(linkBox.value));
  });

  it("shows a v1 string's report before saving, then saves it with an id and nothing lost", async () => {
    const store = createStore(new MemoryBackend());
    renderTransfer(store);
    await paste(await v1String());
    expect(await screen.findByText("Unknown race: Race_X.")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Choice by choice" })).toBeTruthy();
    expect(store.list()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const saved = store.load(store.list()[0]!.id)!;
    expect(saved.id).not.toBe("");
    expect(saved.characters[0]?.levels[0]?.choices["uuid-1/0"]).toEqual(["Skill_A", "Skill_B"]);
    expect(saved.characters[0]?.levels[1]?.choices["uuid-3/1"]).toEqual(["Spell_A"]);
  });

  it("says so when the stored version has the same date", async () => {
    const store = createStore(new MemoryBackend());
    const stored = store.save(badRun("Stored"));
    renderTransfer(store);
    await paste(await encode(stored));
    expect(await screen.findByText("The stored version is the same as this one (same date).")).toBeTruthy();
  });

  it("tells that an unreadable stored run with the same id is kept and asks before saving a new run", async () => {
    const backend = new MemoryBackend();
    backend.items.set("bg3p:run:same", "{nope");
    const store = createStore(backend);
    const onImported = renderTransfer(store);
    await paste(await encode(badRun("Incoming")));
    expect(await screen.findByText(/could not be read and is kept as it is/)).toBeTruthy();
    expect(store.list()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Save as a new run" }));
    expect(store.list().map((s) => s.name)).toEqual(["Incoming"]);
    expect(store.list()[0]?.id).not.toBe("same");
    expect(backend.items.get("bg3p:run:same")).toBe("{nope");
    expect(onImported).toHaveBeenCalled();
  });

  it("shows an export failure as an error, not as a missing run", async () => {
    const store = createStore(new MemoryBackend());
    renderTransfer(store, { ...emptyRun("x"), version: 9 } as unknown as Run);
    expect((await screen.findByRole("alert")).textContent).toMatch(/could not be exported/);
    expect(screen.queryByText("No run to export yet.")).toBeNull();
  });

  it("shows an error, and lets the user retry, when checking throws", async () => {
    const store = createStore(new MemoryBackend());
    const failing = { ...store, list: () => { throw new Error("storage exploded"); } } as RunStore;
    renderTransfer(failing);
    await paste(await encode(badRun("Incoming")));
    expect((await screen.findByRole("alert")).textContent).toMatch(/storage exploded/);
    expect((screen.getByRole("button", { name: "Check" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
