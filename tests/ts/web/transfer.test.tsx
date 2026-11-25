import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import Transfer from "../../../web/src/screens/Transfer.tsx";
import { createStore } from "../../../web/src/state/storage.ts";
import type { RunStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { stubData } from "./stubData.ts";

/** jsdom's Blob has no stream(), which the codec's compression needs: a Blob over byte parts that streams them. */
class StreamingBlob extends Blob {
  readonly chunks: Uint8Array<ArrayBuffer>[];
  constructor(parts: Uint8Array<ArrayBuffer>[]) {
    super(parts);
    this.chunks = parts;
  }
  override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    const parts = this.chunks;
    return new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    });
  }
}

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

function renderTransfer(store: RunStore, runId: string | null = null, onImported = vi.fn()) {
  render(<Transfer data={stubData()} store={store} runId={runId} onImported={onImported} />);
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
    render(<Transfer data={stubData()} store={store} runId={null} initialText={string} onImported={vi.fn()} />);
    expect(await screen.findByText("Unknown race: Race_X.")).toBeTruthy();
  });

  it("exports the current run as a string, readable JSON and a link, each with a copy button", async () => {
    const store = createStore(new MemoryBackend());
    const saved = store.save(badRun("Mine"));
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderTransfer(store, saved.id);
    const string = await encode(store.load(saved.id)!);
    const linkBox = (await screen.findByRole("textbox", { name: "Link" })) as HTMLTextAreaElement;
    expect(linkBox.value).toBe(`${window.location.origin}/#${string}`);
    expect((screen.getByRole("textbox", { name: "Export string" }) as HTMLTextAreaElement).value).toBe(string);
    expect((screen.getByRole("textbox", { name: "Readable JSON" }) as HTMLTextAreaElement).value).toContain('"name": "Mine"');
    const panel = linkBox.closest("section")!;
    fireEvent.click(within(panel).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(linkBox.value));
  });
});
