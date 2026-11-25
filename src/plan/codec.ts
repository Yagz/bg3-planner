import { bareNameOf, nameOf } from "../data/names.ts";
import type { TextKind } from "../data/names.ts";
import type { Texts } from "../data/types.ts";
import { CodecError } from "./errors.ts";
import { CURRENT_VERSION, MIGRATIONS, migrate } from "./migrations.ts";
import type { Migration } from "./migrations.ts";
import { ABILITIES, MAX_LEVELS } from "./model.ts";
import { isOffData } from "./model.ts";
import type { OffData, Run } from "./model.ts";

export { CodecError };

export const PREFIX = "BG3P";

type Json = unknown;
type Obj = Record<string, unknown>;

const HINT_KEYS = new Set(["_name", "_names"]);

// ---------------------------------------------------------------- base64url and compression

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) {
    throw new CodecError("The export string is not valid base64url");
  }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new CodecError("The export string is not valid base64url");
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Encodes a run; a run of the wrong shape is refused with the same messages as a decoding failure. */
export async function encode(run: Run): Promise<string> {
  const valid = validateRun(run);
  const json = new TextEncoder().encode(JSON.stringify(valid));
  const packed = await pipe(json, new CompressionStream("deflate-raw"));
  return `${PREFIX}${CURRENT_VERSION}:${toBase64Url(packed)}`;
}

// ---------------------------------------------------------------- decoding

/** Reads an export string or a JSON document; throws nothing but a `CodecError`. */
export async function decode(
  text: string,
  registry: Record<number, Migration> = MIGRATIONS,
): Promise<{ run: Run; warnings: string[] }> {
  try {
    return await decodeText(text, registry);
  } catch (error) {
    throw asCodecError(error);
  }
}

/**
 * Reads the run's JSON document synchronously (the form the browser stores), through the same hint stripping,
 * migrations and shape checks as `decode`; throws nothing but a `CodecError`.
 */
export function decodeJson(text: string, registry: Record<number, Migration> = MIGRATIONS): Run {
  try {
    const trimmed = text.trim();
    if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) throw new CodecError("Not a JSON document");
    const { raw, version } = readJsonDocument(trimmed);
    return finish(raw, version, registry).run;
  } catch (error) {
    throw asCodecError(error);
  }
}

function asCodecError(error: unknown): CodecError {
  if (error instanceof CodecError) return error;
  // Deep nesting overflows the stack; a migration may throw anything.
  return new CodecError(`The document could not be read: ${error instanceof Error ? error.message : String(error)}`);
}

/** Parses a JSON document and reads its declared version. */
function readJsonDocument(trimmed: string): { raw: Obj; version: number } {
  const raw = parseJson(trimmed);
  if (!isObject(raw)) throw new CodecError("The JSON document is not an object");
  const declared = raw["version"];
  if (typeof declared !== "number" || !Number.isInteger(declared)) {
    throw new CodecError("Invalid field version: expected an integer");
  }
  return { raw, version: declared };
}

/** Strips the hint fields, migrates to the current version and checks the shape. */
function finish(raw: unknown, version: number, registry: Record<number, Migration>): { run: Run; warnings: string[] } {
  const hints = { count: 0 };
  const cleaned = stripHints(raw, hints);
  const migrated = migrate(cleaned, version, registry);
  if (!isObject(migrated) || migrated["version"] !== CURRENT_VERSION) {
    throw new CodecError(`A migration left the data at version ${isObject(migrated) ? JSON.stringify(migrated["version"]) : "?"}, expected ${CURRENT_VERSION}`);
  }
  const run = validateRun(migrated);
  const warnings = hints.count > 0 ? [`Ignored ${hints.count} hint field(s) (_name / _names): they are display aids, not data`] : [];
  return { run, warnings };
}

async function decodeText(text: string, registry: Record<number, Migration>): Promise<{ run: Run; warnings: string[] }> {
  const trimmed = text.trim();
  if (trimmed === "") throw new CodecError("Nothing to import: the text is empty");

  let raw: unknown;
  let version: number;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    ({ raw, version } = readJsonDocument(trimmed));
  } else {
    const colon = trimmed.indexOf(":");
    const head = colon < 0 ? trimmed : trimmed.slice(0, colon);
    if (!head.startsWith(PREFIX)) throw new CodecError(`Unknown prefix: expected "${PREFIX}<version>:" or a JSON document`);
    const digits = head.slice(PREFIX.length);
    if (colon < 0 || !/^\d+$/.test(digits)) throw new CodecError(`Malformed prefix "${head}": expected "${PREFIX}<version>:"`);
    version = Number(digits);
    if (version > CURRENT_VERSION) {
      throw new CodecError(`Format version ${version} is newer than this planner understands (${CURRENT_VERSION})`);
    }
    const packed = fromBase64Url(trimmed.slice(colon + 1));
    let bytes: Uint8Array;
    try {
      bytes = await pipe(packed, new DecompressionStream("deflate-raw"));
    } catch {
      throw new CodecError("The export string is not valid compressed data");
    }
    let json: string;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new CodecError("The export string does not contain valid UTF-8 text");
    }
    raw = parseJson(json);
    if (!isObject(raw)) throw new CodecError("The decoded JSON is not an object");
    if (raw["version"] !== version) {
      throw new CodecError(`The prefix says version ${version} but the data says ${JSON.stringify(raw["version"])}`);
    }
  }

  return finish(raw, version, registry);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CodecError(`Invalid JSON: ${(error as Error).message}`);
  }
}

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripHints(value: Json, hints: { count: number }, path = ""): Json {
  if (Array.isArray(value)) return value.map((item, i) => stripHints(item, hints, at(path, i)));
  if (isObject(value)) {
    const out: Obj = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === "__proto__") throw new CodecError(`Forbidden key ${at(path, key)}: "__proto__" cannot be stored`);
      if (HINT_KEYS.has(key)) {
        hints.count++;
        continue;
      }
      out[key] = stripHints(item, hints, at(path, key));
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------- shape validation

function fail(path: string, expected: string): never {
  throw new CodecError(`Invalid field ${path}: expected ${expected}`);
}

function at(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : path === "" ? key : `${path}.${key}`;
}

function object(value: unknown, path: string, keys: readonly string[]): Obj {
  if (!isObject(value)) fail(path || "(root)", "an object");
  for (const key of keys) {
    if (!(key in value)) throw new CodecError(`Missing field ${at(path, key)}`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new CodecError(`Unknown field ${at(path, key)}`);
  }
  return value;
}

function str(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "a string");
  return value;
}

function int(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) fail(path, "an integer");
  return value;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "an array");
  return value;
}

function strings(value: unknown, path: string): string[] {
  return array(value, path).map((item, i) => str(item, at(path, i)));
}

function record<T>(value: unknown, path: string, item: (v: unknown, p: string) => T): Record<string, T> {
  if (!isObject(value)) fail(path, "an object");
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(value)) out[key] = item(v, at(path, key));
  return out;
}

function offData(value: unknown, path: string): OffData {
  const obj = object(value, path, ["offData"]);
  return { offData: str(obj["offData"], at(path, "offData")) };
}

function choice(value: unknown, path: string): Run["characters"][number]["levels"][number]["choices"][string] {
  if (value === "todo") return "todo";
  if (Array.isArray(value)) return strings(value, path);
  if (isObject(value)) return offData(value, path);
  return fail(path, 'a list of identifiers, "todo" or {"offData": string}');
}

/** An identifier (or null where allowed) or a value outside the game data. */
function identity(value: unknown, path: string): string | OffData {
  if (isObject(value)) return offData(value, path);
  if (typeof value !== "string") fail(path, 'a string or {"offData": string}');
  return value;
}

function validateRun(raw: unknown): Run {
  const r = object(raw, "", [
    "version", "id", "updatedAt", "name", "origin", "difficulty", "partySize", "progress", "party",
    "characters", "decisions", "bonuses", "uniqueItems", "notes",
  ]);
  if (r["version"] !== CURRENT_VERSION) fail("version", String(CURRENT_VERSION));

  const updatedAt = r["updatedAt"];
  if (updatedAt !== null && typeof updatedAt !== "string") fail("updatedAt", "a string or null");

  const progress = object(r["progress"], "progress", ["level", "act"]);
  const act = progress["act"];
  if (act !== 1 && act !== 2 && act !== 3) fail("progress.act", "1, 2 or 3");

  const partyRaw = object(r["party"], "party", ["1", "2", "3"]);
  const actParty = (key: "1" | "2" | "3") => {
    const path = at("party", key);
    const p = object(partyRaw[key], path, ["active", "status"]);
    return {
      active: strings(p["active"], at(path, "active")),
      status: record(p["status"], at(path, "status"), (v, vp) => {
        if (v !== "core" && v !== "alternative" && v !== "bench") fail(vp, '"core", "alternative" or "bench"');
        return v;
      }),
    };
  };

  const characters = array(r["characters"], "characters").map((value, i) => {
    const path = at("characters", i);
    const c = object(value, path, ["id", "who", "race", "subrace", "background", "abilities", "levels", "items", "notes"]);
    const abilitiesRaw = object(c["abilities"], at(path, "abilities"), ABILITIES);
    const abilities = {} as Run["characters"][number]["abilities"];
    for (const ability of ABILITIES) abilities[ability] = int(abilitiesRaw[ability], at(at(path, "abilities"), ability));
    const levelsRaw = array(c["levels"], at(path, "levels"));
    if (levelsRaw.length > MAX_LEVELS) fail(at(path, "levels"), `at most ${MAX_LEVELS} levels`);
    const levels = levelsRaw.map((lv, j) => {
      const lp = at(at(path, "levels"), j);
      const l = object(lv, lp, ["class", "choices"]);
      return { class: identity(l["class"], at(lp, "class")), choices: record(l["choices"], at(lp, "choices"), choice) };
    });
    const subrace = c["subrace"];
    return {
      id: str(c["id"], at(path, "id")),
      who: str(c["who"], at(path, "who")),
      race: identity(c["race"], at(path, "race")),
      subrace: subrace === null ? null : identity(subrace, at(path, "subrace")),
      background: identity(c["background"], at(path, "background")),
      abilities,
      levels,
      items: strings(c["items"], at(path, "items")),
      notes: str(c["notes"], at(path, "notes")),
    };
  });

  return {
    version: 2,
    id: str(r["id"], "id"),
    updatedAt,
    name: str(r["name"], "name"),
    origin: str(r["origin"], "origin"),
    difficulty: str(r["difficulty"], "difficulty"),
    partySize: int(r["partySize"], "partySize"),
    progress: { level: int(progress["level"], "progress.level"), act },
    party: { "1": actParty("1"), "2": actParty("2"), "3": actParty("3") },
    characters,
    decisions: record(r["decisions"], "decisions", str),
    bonuses: strings(r["bonuses"], "bonuses"),
    uniqueItems: strings(r["uniqueItems"], "uniqueItems"),
    notes: str(r["notes"], "notes"),
  };
}

// ---------------------------------------------------------------- readable JSON

/** The identifier of a value, or null for a missing one or a value outside the game data (which has no hint). */
function idOf(value: string | null | OffData): string | null {
  return isOffData(value) ? null : value;
}

/** A hint entry per identifier; `kind` is null for choices, whose kind is not known. */
function names(ids: Iterable<string | null>, texts: Texts, kind: TextKind | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    if (id === null || id === "") continue;
    const name = kind === null ? bareNameOf(texts, id) : nameOf(texts, kind, id);
    if (name !== null) out[id] = name;
  }
  return out;
}

function withNames<T extends object>(value: T, found: Record<string, string>): T & { _names?: Record<string, string> } {
  return Object.keys(found).length > 0 ? { ...value, _names: found } : value;
}

/** Pretty JSON of the run with a `_names` hint (display names in one language) on each object that holds identifiers. */
export function toReadableJson(run: Run, texts: Texts): string {
  const characters = run.characters.map((c) => {
    const levels = c.levels.map((level) =>
      withNames(
        level,
        {
          ...names([idOf(level.class)], texts, "class"),
          ...names(Object.values(level.choices).flatMap((ch) => (Array.isArray(ch) ? ch : [])), texts, null),
        },
      ),
    );
    const found = {
      ...names([idOf(c.race), idOf(c.subrace)], texts, "race"),
      ...names([idOf(c.background)], texts, "background"),
      ...names(c.items, texts, "item"),
      ...names(c.levels.map((l) => idOf(l.class)), texts, "class"),
    };
    return withNames({ ...c, levels }, found);
  });
  const out = withNames({ ...run, characters }, names(run.uniqueItems, texts, "item"));
  return JSON.stringify(out, null, 2);
}
