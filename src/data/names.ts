import type { Texts } from "./types.ts";

/** Kinds that prefix the keys of the texts tables (`<kind>:<id>`). */
export type TextKind =
  | "ability"
  | "background"
  | "class"
  | "feat"
  | "item"
  | "origin"
  | "passive"
  | "race"
  | "skill"
  | "spell";

const KINDS: TextKind[] = ["ability", "background", "class", "feat", "item", "origin", "passive", "race", "skill", "spell"];

/** Display name of `id` of a known kind, or null when the table has none. */
export function nameOf(texts: Texts, kind: TextKind, id: string): string | null {
  const key = `${kind}:${id}`;
  return Object.hasOwn(texts, key) ? (texts[key]?.name ?? null) : null;
}

/**
 * Display name of a bare identifier whose kind is unknown (a choice): a name only when every kind holding the id
 * gives the same one; never a guess between different names.
 */
export function bareNameOf(texts: Texts, id: string): string | null {
  let found: string | null = null;
  for (const kind of KINDS) {
    const name = nameOf(texts, kind, id);
    if (name === null) continue;
    if (found !== null && found !== name) return null;
    found = name;
  }
  return found;
}
