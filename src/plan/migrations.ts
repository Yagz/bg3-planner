import { CodecError } from "./errors.ts";

export const CURRENT_VERSION = 1;

export type Migration = (raw: unknown) => unknown;

/** `MIGRATIONS[v]` turns a version-v document into a version-(v+1) one. Empty while v1 is the only version. */
export const MIGRATIONS: Record<number, Migration> = {};

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
