import type { Texts } from "./types.ts";

/** Kinds that prefix the keys of the texts tables (`<kind>:<id>`). */
export type TextKind =
  | "ability"
  | "background"
  | "class"
  | "feat"
  | "item"
  | "label"
  | "modifier"
  | "origin"
  | "passive"
  | "race"
  | "ruleset"
  | "skill"
  | "slot"
  | "damage"
  | "spell";

const KINDS: TextKind[] = ["ability", "background", "class", "feat", "item", "label", "modifier", "origin", "passive", "race", "ruleset", "skill", "slot", "damage", "spell"];

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

/** How description parameters are shown: the language, the name of a damage type, and the marker for a value that depends on the level. */
export type ParamFormat = { lang: "en" | "fr"; damageName: (type: string) => string | null; variable: string };

const PLAIN = /^\d+(d\d+)?([+-]\d+)?$/;

function renderParam(param: string | undefined, format: ParamFormat): string {
  const text = (param ?? "").trim();
  if (PLAIN.test(text)) return text;
  const call = /^(\w+)\((.*)\)$/.exec(text);
  if (call === null) return format.variable;
  const [, form, args] = call;
  const inner = (args ?? "").trim();
  if (form === "Distance" && /^\d+(\.\d+)?$/.test(inner)) return `${format.lang === "fr" ? inner.replace(".", ",") : inner} m`;
  if ((form === "RegainHitPoints" || form === "GainTemporaryHitPoints") && PLAIN.test(inner)) return inner;
  if (form === "DealDamage") {
    const [dice, type] = inner.split(",").map((part) => part.trim());
    if (dice !== undefined && PLAIN.test(dice)) {
      const name = type === undefined ? null : format.damageName(type);
      return name === null || name === "" ? dice : `${dice} ${name}`;
    }
    // A level- or ability-dependent amount: keep the damage type beside the marker.
    const name = type === undefined ? null : format.damageName(type);
    return name === null || name === "" ? format.variable : `${format.variable} ${name}`;
  }
  return format.variable;
}

/** Replaces each `[n]` (1-based) of a description by its rendered parameter; a missing, empty or level-dependent one reads as `format.variable`. */
export function renderParams(description: string, params: string[], format: ParamFormat): string {
  return description.replace(/\[(\d+)\]/g, (_, n: string) => renderParam(params[Number(n) - 1], format));
}

/**
 * Description of `id` of a known kind as plain text (the game's markup tags dropped, line breaks as spaces), or null when there is none.
 * When `params` and `format` are given, the `[n]` placeholders are rendered first.
 */
export function descriptionOf(texts: Texts, kind: TextKind, id: string, params?: string[], format?: ParamFormat): string | null {
  const key = `${kind}:${id}`;
  const raw = Object.hasOwn(texts, key) ? (texts[key]?.description ?? null) : null;
  if (raw === null) return null;
  const description = params !== undefined && format !== undefined ? renderParams(raw, params, format) : raw;
  const plain = description
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain === "" ? null : plain;
}
