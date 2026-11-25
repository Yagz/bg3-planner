import { CodecError } from "./errors.ts";

export const CURRENT_VERSION = 2;

export type Migration = (raw: unknown) => unknown;

/** `MIGRATIONS[v]` turns a version-v document into a version-(v+1) one. */
export const MIGRATIONS: Record<number, Migration> = {
  // Version 2 adds the run's stable id (empty until the planner assigns one) and its update date.
  1: (raw) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CodecError("Cannot migrate: the document is not an object");
    return { ...raw, version: 2, id: "", updatedAt: null };
  },
};

/** Brings a document of `fromVersion` up to CURRENT_VERSION, one step at a time. */
export function migrate(raw: unknown, fromVersion: number, registry: Record<number, Migration> = MIGRATIONS): unknown {
  if (!Number.isInteger(fromVersion) || fromVersion < 0) {
    throw new CodecError(`Invalid format version ${String(fromVersion)}`);
  }
  if (fromVersion > CURRENT_VERSION) {
    throw new CodecError(`Format version ${fromVersion} is newer than this planner understands (${CURRENT_VERSION})`);
  }
  let current = raw;
  for (let version = fromVersion; version < CURRENT_VERSION; version++) {
    const step = registry[version];
    if (step === undefined) {
      throw new CodecError(`No migration from format version ${version} to ${version + 1}`);
    }
    current = step(current);
  }
  return current;
}
