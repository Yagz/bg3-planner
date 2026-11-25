import { emptyRun } from "../../../src/plan/model.ts";
import type { RunStore, RunSummary } from "./storage.ts";

/** Creates and saves an empty run named `name`; returns its id. */
export function createRun(store: RunStore, name: string): string {
  const run = emptyRun();
  run.name = name;
  return store.save(run).id;
}

/** Saves run `id` under a new name (trimmed); returns its id, or null when there is no such run. */
export function renameRun(store: RunStore, id: string, name: string): string | null {
  const run = store.load(id);
  return run === null ? null : store.save({ ...run, name: name.trim() }).id;
}

/** Saves a copy of run `id` under a new id, named by `copyName(original name)`; returns the copy's id, or null. */
export function duplicateRun(store: RunStore, id: string, copyName: (name: string) => string): string | null {
  const run = store.load(id);
  return run === null ? null : store.save({ ...run, id: "", name: copyName(run.name) }).id;
}

/** Removes run `id` and its history; returns the run to show next (the most recent left), or null. */
export function deleteRun(store: RunStore, id: string): string | null {
  store.remove(id);
  return store.list()[0]?.id ?? null;
}

/** The run to show: the preferred one when it exists, else the most recent one, or null when there is none. */
export function currentRunId(runs: RunSummary[], preferred: string | null): string | null {
  return runs.some((run) => run.id === preferred) ? preferred : (runs[0]?.id ?? null);
}
