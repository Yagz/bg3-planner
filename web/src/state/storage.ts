import { decodeJson } from "../../../src/plan/codec.ts";
import type { Run } from "../../../src/plan/model.ts";

export type RunSummary = { id: string; name: string; updatedAt: string | null };

/** One saved version of a run; `text` is the run's JSON, readable by `decodeJson` (and `decode`) across versions. */
export type HistoryEntry = { at: string; text: string; note?: HistoryNote };

/** Why a version was saved when it is not an edit: an import, or the restore of the version saved at `from`. */
export type HistoryNote = { kind: "import" } | { kind: "restore"; from: string };

/** A stored run that could not be read; it is kept in storage untouched. */
export type UnreadableRun = { id: string; message: string };

export type SaveOptions = {
  /**
   * Keeps the run's own `updatedAt` (an imported run keeps the date of its last edit, so a re-exported copy never looks
   * newer than a later real edit); a run without a date is stamped. The saved version's history time still increases.
   */
  keepDate?: boolean;
  /** Recorded with the saved version. */
  note?: HistoryNote;
};

export type RunStore = {
  /** Readable runs, most recently updated first. */
  list(): RunSummary[];
  load(id: string): Run | null;
  /**
   * Saves a new version; an empty id gets a UUID. Returns the saved run. A real edit gets `updatedAt` set now, strictly after
   * the run's previous `updatedAt` and its newest version. Before writing, the run's stored record is read again and the
   * versions another tab saved meanwhile are merged in by time, never dropped.
   * Throws, writing nothing, when the id is that of an unreadable stored run: it is never overwritten (save a copy instead).
   */
  save(run: Run, options?: SaveOptions): Run;
  /** Saved versions, newest first; the first one is the current run. `at` is the time the version was saved. */
  history(id: string): HistoryEntry[];
  /** Saves version `at` as the current run (so the replaced one stays in history) and returns it. */
  restore(id: string, at: string): Run;
  remove(id: string): void;
  /** Reads the stored runs again (another tab may have added, changed or removed some); a no-op without storage. */
  refresh(): void;
  unreadable(): UnreadableRun[];
  /** False once the browser storage is absent or refused a read or write: runs then live in memory only. */
  readonly available: boolean;
};

const INDEX_KEY = "bg3p:index";
const RUN_PREFIX = "bg3p:run:";
export const HISTORY_LIMIT = 20;

type Entry = { summary: RunSummary; history: HistoryEntry[] };

/** A note this site wrote; anything else (a later version's note kind, a damaged one) is dropped when read. */
function validNote(note: unknown): note is HistoryNote | undefined {
  if (note === undefined) return true;
  const { kind, from } = (note ?? {}) as { kind?: unknown; from?: unknown };
  return kind === "import" || (kind === "restore" && typeof from === "string");
}

/** Reads a stored record; throws on anything that is not a readable run. */
function readRecord(text: string): { history: HistoryEntry[]; run: Run } {
  const record: unknown = JSON.parse(text);
  const history = (record as { history?: unknown } | null)?.history;
  if (!Array.isArray(history) || history.length === 0) throw new Error("No saved version");
  for (const entry of history) {
    if (typeof entry?.at !== "string" || typeof entry?.text !== "string") throw new Error("Malformed history entry");
    if (Number.isNaN(Date.parse(entry.at))) throw new Error(`Saved version date ${JSON.stringify(entry.at)} is not a date`);
  }
  for (const entry of history as HistoryEntry[]) if (!validNote(entry.note)) delete entry.note;
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

  /** Reads every stored run again, replacing what is held in memory; switches to memory when the storage refuses. */
  const scan = () => {
    if (!available || backend === null) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < backend.length; i++) {
        const key = backend.key(i);
        if (key?.startsWith(RUN_PREFIX)) keys.push(key);
      }
      entries.clear();
      broken.clear();
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
  };
  scan();

  /**
   * The versions of run `id` stored now (another tab may have saved some); empty when none is stored or the storage
   * refuses the read. A record that cannot be read (another tab, maybe a newer version of the site, wrote it) is marked
   * unreadable and the call throws: it is never overwritten.
   */
  const storedHistory = (id: string): HistoryEntry[] => {
    if (!available || backend === null) return [];
    let text: string | null;
    try {
      text = backend.getItem(RUN_PREFIX + id);
    } catch {
      return [];
    }
    if (text === null) return [];
    try {
      return readRecord(text).history;
    } catch (error) {
      entries.delete(id);
      broken.set(id, error instanceof Error ? error.message : String(error));
      throw new Error(`The stored run ${id} could not be read; it is kept and not overwritten`);
    }
  };

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

  const save = (input: Run, options: SaveOptions = {}): Run => {
    const run = structuredClone(input);
    if (run.id === "") run.id = crypto.randomUUID();
    if (broken.has(run.id)) throw new Error(`The stored run ${run.id} could not be read; it is kept and not overwritten`);
    const held = entries.get(run.id);
    // Versions are merged by time with what another tab stored meanwhile: none is dropped.
    const merged = new Map<string, HistoryEntry>();
    for (const entry of [...storedHistory(run.id), ...(held?.history ?? [])]) if (!merged.has(entry.at)) merged.set(entry.at, entry);
    const previous = [...merged.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const newest = previous[0] === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previous[0].at);
    const now = Date.now();
    const at = new Date(now > newest ? now : newest + 1).toISOString();
    const keep = options.keepDate === true && run.updatedAt !== null && !Number.isNaN(Date.parse(run.updatedAt));
    if (!keep) {
      // A real edit is dated after the run's previous date too, which an imported copy may have set ahead of this clock.
      const dates = [Date.parse(at), ...[held?.summary.updatedAt, previous[0] === undefined ? null : decodeJson(previous[0].text).updatedAt].map((date) => (date == null ? Number.NaN : Date.parse(date) + 1))];
      run.updatedAt = new Date(Math.max(...dates.filter((date) => !Number.isNaN(date)))).toISOString();
    }
    const stamp = keep ? at : (run.updatedAt as string);
    const saved: HistoryEntry = { at: stamp, text: JSON.stringify(run) };
    if (options.note !== undefined) saved.note = options.note;
    const history = [saved, ...previous].slice(0, HISTORY_LIMIT);
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
      return save(decodeJson(entry.text), { note: { kind: "restore", from: at } });
    },
    refresh: scan,
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
