// @vitest-environment node
import { describe, expect, it } from "vitest";
import { commitImport, importRun } from "../../../web/src/state/importRun.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { encode } from "../../../src/plan/codec.ts";
import { emptyRun } from "../../../src/plan/model.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { stubData } from "./stubData.ts";

const data = stubData();

async function v1String(): Promise<string> {
  const { id: _i, updatedAt: _u, ...rest } = emptyRun("r1");
  const stream = new Blob([new TextEncoder().encode(JSON.stringify({ ...rest, version: 1, name: "Old" }))]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return "BG3P1:" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("importRun", () => {
  it("reports garbage as an error with the codec message", async () => {
    const result = await importRun("not a run", createStore(new MemoryBackend()), data);
    expect(result.kind).toBe("error");
    expect(result.kind === "error" && result.message.length > 0).toBe(true);
  });

  it("migrates a v1 string, saves nothing, and assigns an id on commit", async () => {
    const store = createStore(new MemoryBackend());
    const result = await importRun(await v1String(), store, data);
    if (result.kind !== "ready") throw new Error("expected ready");
    expect(result.run.version).toBe(2);
    expect(result.run.id).toBe("");
    expect(result.run.name).toBe("Old");
    expect(result.conflict).toBeNull();
    expect(store.list()).toEqual([]);
    const saved = commitImport(result, store, "replace");
    expect(saved.id).not.toBe("");
    expect(store.list().map((s) => s.name)).toEqual(["Old"]);
  });

  it("reads a full link and a readable JSON document", async () => {
    const store = createStore(new MemoryBackend());
    const run = { ...emptyRun("link-1"), name: "Linked" };
    const string = await encode(run);
    const viaLink = await importRun(`https://example.org/bg3-planner/#${string}`, store, data);
    expect(viaLink.kind === "ready" && viaLink.run.name).toBe("Linked");
    const viaJson = await importRun(JSON.stringify(run, null, 2), store, data);
    expect(viaJson.kind === "ready" && viaJson.run.id).toBe("link-1");
  });

  it("flags a stored run with the same id, and which version is newer", async () => {
    const store = createStore(new MemoryBackend());
    const stored = store.save({ ...emptyRun("same"), name: "Stored" });
    const older = { ...stored, updatedAt: "2000-01-01T00:00:00.000Z" };
    const newer = { ...stored, updatedAt: "2999-01-01T00:00:00.000Z" };
    const none = { ...stored, updatedAt: null };
    const check = async (run: typeof stored) => {
      const result = await importRun(await encode(run), store, data);
      return result.kind === "ready" ? result.conflict?.newer : "error";
    };
    expect(await check(older)).toBe("stored");
    expect(await check(newer)).toBe("incoming");
    expect(await check(none)).toBe("unknown");
    expect(store.list()).toHaveLength(1);
  });

  it("replace keeps the stored version in history; copy leaves the stored run alone", async () => {
    const store = createStore(new MemoryBackend());
    const stored = store.save({ ...emptyRun("same"), name: "Stored" });
    const result = await importRun(await encode({ ...stored, name: "Incoming" }), store, data);
    const copy = commitImport(result, store, "copy");
    expect(copy.id).not.toBe("same");
    expect(store.load("same")?.name).toBe("Stored");
    expect(store.history("same")).toHaveLength(1);
    commitImport(result, store, "replace");
    expect(store.load("same")?.name).toBe("Incoming");
    expect(store.history("same").map((h) => JSON.parse(h.text).name)).toEqual(["Incoming", "Stored"]);
  });

  it("never writes over an unreadable stored record", async () => {
    const backend = new MemoryBackend();
    backend.items.set("bg3p:run:broken", "{nope");
    const store = createStore(backend);
    const result = await importRun(await encode({ ...emptyRun("broken"), name: "Mine" }), store, data);
    const saved = commitImport(result, store, "replace");
    expect(saved.id).not.toBe("broken");
    expect(backend.items.get("bg3p:run:broken")).toBe("{nope");
  });
});
