import type { GameData } from "../../../src/data/types.ts";
import type { Report } from "../../../src/engine/issues.ts";
import { validate } from "../../../src/engine/validate.ts";
import { CodecError, decode } from "../../../src/plan/codec.ts";
import type { Run } from "../../../src/plan/model.ts";
import type { RunStore, RunSummary } from "./storage.ts";

export type Conflict = {
  /** The readable stored run with the same id; null when the stored record of that id could not be read. */
  stored: RunSummary | null;
  /**
   * Which of the two versions was edited last: "same" for identical dates, "unknown" when either date is missing or unreadable,
   * "unreadable" when the stored record with this id cannot be read (it is kept; the import would be saved as a new run).
   */
  newer: "stored" | "incoming" | "unknown" | "same" | "unreadable";
};

export type ImportResult =
  | { kind: "error"; message: string }
  | { kind: "ready"; run: Run; report: Report; warnings: string[]; conflict: Conflict | null };

/** The export string of a pasted run link (`…#BG3P2:…`), or the text itself. */
function stringOf(text: string): string {
  const trimmed = text.trim();
  const hash = trimmed.indexOf("#BG3P");
  if (hash < 0) return trimmed;
  const fragment = trimmed.slice(hash + 1);
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function newerOf(stored: string | null, incoming: string | null): Exclude<Conflict["newer"], "unreadable"> {
  if (stored === null || incoming === null) return "unknown";
  const a = Date.parse(stored);
  const b = Date.parse(incoming);
  if (Number.isNaN(a) || Number.isNaN(b)) return "unknown";
  return a === b ? "same" : a > b ? "stored" : "incoming";
}

/**
 * Reads a pasted export string, run link or readable JSON and validates it; nothing is saved (see `commitImport`).
 * A run whose id is already stored is flagged as a conflict so the caller can ask before replacing it.
 */
export async function importRun(text: string, store: RunStore, data: GameData): Promise<ImportResult> {
  let decoded: { run: Run; warnings: string[] };
  try {
    decoded = await decode(stringOf(text));
  } catch (error) {
    return { kind: "error", message: error instanceof CodecError ? error.message : String(error) };
  }
  const { run, warnings } = decoded;
  const stored = run.id === "" ? undefined : store.list().find((summary) => summary.id === run.id);
  const conflict: Conflict | null =
    stored !== undefined
      ? { stored, newer: newerOf(stored.updatedAt, run.updatedAt) }
      : run.id !== "" && store.unreadable().some((record) => record.id === run.id)
        ? { stored: null, newer: "unreadable" }
        : null;
  return { kind: "ready", run, report: validate(run, data), warnings, conflict };
}

/**
 * Saves a ready import: "replace" saves it over the run with the same id (the store keeps the replaced version in history),
 * "copy" saves it under a new id and leaves the stored run alone. Returns the saved run.
 * A run whose id is that of an unreadable stored record is never written over it: it is saved under a new id.
 * The run keeps its own edit date (`updatedAt`), so a re-exported unchanged copy never looks newer than a later real edit.
 */
export function commitImport(result: ImportResult, store: RunStore, mode: "replace" | "copy"): Run {
  if (result.kind !== "ready") throw new Error("Nothing to import");
  const unreadable = store.unreadable().some((record) => record.id === result.run.id);
  const id = mode === "copy" || unreadable ? crypto.randomUUID() : result.run.id;
  return store.save({ ...result.run, id }, { keepDate: true });
}
