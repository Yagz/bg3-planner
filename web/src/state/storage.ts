import { decodeJson } from "../../../src/plan/codec.ts";
import type { Run } from "../../../src/plan/model.ts";

export type RunSummary = { id: string; name: string; updatedAt: string | null };

/** One saved version of a run; `text` is the run's JSON, readable by `decodeJson` (and `decode`) across versions. */
export type HistoryEntry = { at: string; text: string };

/** A stored run that could not be read; it is kept in storage untouched. */
export type UnreadableRun = { id: string; message: string };

export type RunStore = {
  /** Readable runs, most recently updated first. */
  list(): RunSummary[];
  load(id: string): Run | null;
  /** Saves a new version (`updatedAt` set now, strictly after the previous version); an empty id gets a UUID. Returns the saved run. */
  save(run: Run): Run;
  /** Saved versions, newest first; the first one is the current run. */
  history(id: string): HistoryEntry[];
  /** Saves version `at` as the current run (so the replaced one stays in history) and returns it. */
  restore(id: string, at: string): Run;
  remove(id: string): void;
  unreadable(): UnreadableRun[];
  /** False once the browser storage is absent or refused a read or write: runs then live in memory only. */
  readonly available: boolean;
};

const INDEX_KEY = "bg3p:index";
const RUN_PREFIX = "bg3p:run:";
export const HISTORY_LIMIT = 20;

type Entry = { summary: RunSummary; history: HistoryEntry[] };

/** Reads a stored record; throws on anything that is not a readable run. */
function readRecord(text: string): { history: HistoryEntry[]; run: Run } {
  const record: unknown = JSON.parse(text);
  const history = (record as { history?: unknown } | null)?.history;
  if (!Array.isArray(history) || history.length === 0) throw new Error("No saved version");
  for (const entry of history) {
    if (typeof entry?.at !== "string" || typeof entry?.text !== "string") throw new Error("Malformed history entry");
  }
  return { history: history as HistoryEntry[], run: decodeJson((history[0] as HistoryEntry).text) };
}

function summaryOf(run: Run): RunSummary {
  return { id: run.id, name: run.name, updatedAt: run.updatedAt };
}

/** A run store over `backend` (normally `localStorage`); any storage failure switches it to memory, never throws. */
export function createStore(backend: Storage | null): RunStore {
  const entries = new Map<string, Entry>();
  const broken = new Map<string, string>();
  let available = backend !== null;

  if (backend !== null) {
    try {
      const keys: string[] = [];
      for (let i = 0; i < backend.length; i++) {
        const key = backend.key(i);
        if (key?.startsWith(RUN_PREFIX)) keys.push(key);
      }
      for (const key of keys) {
        const id = key.slice(RUN_PREFIX.length);
        try {
          const { history, run } = readRecord(backend.getItem(key) ?? "");
          entries.set(id, { summary: { ...summaryOf(run), id }, history });
        } catch (error) {
          broken.set(id, error instanceof Error ? error.message : String(error));
        }
      }
    } catch {
      available = false;
    }
  }

  const write = (change: (storage: Storage) => void) => {
    if (!available || backend === null) return;
    try {
      change(backend);
      backend.setItem(INDEX_KEY, JSON.stringify(list()));
    } catch {
      available = false;
    }
  };

  const list = (): RunSummary[] =>
    [...entries.values()].map((entry) => ({ ...entry.summary })).sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const save = (input: Run): Run => {
    const run = structuredClone(input);
    if (run.id === "") run.id = crypto.randomUUID();
    const previous = entries.get(run.id)?.history ?? [];
    const now = Date.now();
    const last = previous[0] === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previous[0].at);
    run.updatedAt = new Date(now > last ? now : last + 1).toISOString();
    const history = [{ at: run.updatedAt, text: JSON.stringify(run) }, ...previous].slice(0, HISTORY_LIMIT);
    entries.set(run.id, { summary: summaryOf(run), history });
    write((storage) => storage.setItem(RUN_PREFIX + run.id, JSON.stringify({ history })));
    return structuredClone(run);
  };

  return {
    list,
    load(id) {
      const current = entries.get(id)?.history[0];
      return current === undefined ? null : decodeJson(current.text);
    },
    save,
    history(id) {
      return (entries.get(id)?.history ?? []).map((entry) => ({ ...entry }));
    },
    restore(id, at) {
      const entry = entries.get(id)?.history.find((version) => version.at === at);
      if (entry === undefined) throw new Error(`No saved version of run ${id} at ${at}`);
      return save(decodeJson(entry.text));
    },
    remove(id) {
      if (!entries.delete(id)) return;
      write((storage) => storage.removeItem(RUN_PREFIX + id));
    },
    unreadable() {
      return [...broken].map(([id, message]) => ({ id, message }));
    },
    get available() {
      return available;
    },
  };
}
