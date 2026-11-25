import { describe, expect, it } from "vitest";
import { createRun, currentRunId, deleteRun, duplicateRun, renameRun } from "../../../web/src/state/runs.ts";
import { createStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";

const names = (store: ReturnType<typeof createStore>) => store.list().map((summary) => summary.name).sort();

describe("run actions", () => {
  it("create a run with the given name and return its new id", () => {
    const store = createStore(new MemoryBackend());
    const id = createRun(store, "Fresh");
    expect(store.load(id)?.name).toBe("Fresh");
    expect(createRun(store, "Other")).not.toBe(id);
  });

  it("rename a run, trimming the name; an unknown id changes nothing", () => {
    const store = createStore(new MemoryBackend());
    const id = createRun(store, "Old");
    expect(renameRun(store, id, "  New name ")).toBe(id);
    expect(store.load(id)?.name).toBe("New name");
    expect(store.history(id)).toHaveLength(2);
    expect(renameRun(store, "missing", "X")).toBeNull();
    expect(names(store)).toEqual(["New name"]);
  });

  it("duplicate a run under a new id and the name the caller builds, with the same content", () => {
    const store = createStore(new MemoryBackend());
    const id = createRun(store, "Base");
    const run = store.load(id)!;
    run.notes = "kept";
    store.save(run);
    const copy = duplicateRun(store, id, (name) => `${name} (copy)`)!;
    expect(copy).not.toBe(id);
    expect(store.load(copy)).toMatchObject({ name: "Base (copy)", notes: "kept" });
    expect(store.history(copy)).toHaveLength(1);
    expect(duplicateRun(store, "missing", (name) => name)).toBeNull();
  });

  it("delete a run and return the run to show next", () => {
    const store = createStore(new MemoryBackend());
    const a = createRun(store, "A");
    const b = createRun(store, "B");
    expect(deleteRun(store, b)).toBe(a);
    expect(names(store)).toEqual(["A"]);
    expect(deleteRun(store, a)).toBeNull();
  });

  it("pick the preferred run when it exists, else the most recent one", () => {
    const runs = [
      { id: "new", name: "", updatedAt: "2026-11-25T11:00:00.000Z" },
      { id: "old", name: "", updatedAt: "2026-11-25T10:00:00.000Z" },
    ];
    expect(currentRunId(runs, "old")).toBe("old");
    expect(currentRunId(runs, "gone")).toBe("new");
    expect(currentRunId(runs, null)).toBe("new");
    expect(currentRunId([], "old")).toBeNull();
  });
});
