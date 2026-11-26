import { createContext, useContext } from "react";
import type { TextKind } from "../../../src/data/names.ts";
import type { Issue } from "../../../src/engine/issues.ts";
import en from "./en.json";
import fr from "./fr.json";

export type Lang = "fr" | "en";
export const LANGS: Lang[] = ["fr", "en"];

export type Translate = (key: string, params?: Record<string, string | number>) => string;
/** Display name of a game identifier (`kind` null for a bare choice id), never blank. */
export type NameOf = (kind: TextKind | null, id: string) => string;

export type I18n = {
  lang: Lang;
  t: Translate;
  /** The message of an engine issue, its identifiers shown by name. */
  issueMessage: (issue: Issue, names: NameOf) => string;
};

const TABLES: Record<Lang, Record<string, string>> = { en, fr };

/** Issue parameters that hold game identifiers, with the kind of their name; the others are shown as they are. */
const NAMED_PARAMS: Record<string, TextKind | null> = {
  ability: "ability",
  background: "background",
  class: "class",
  feat: "feat",
  item: null,
  parent: "class",
  proficiency: null,
  race: "race",
  slot: "slot",
  subclass: "class",
  subrace: "race",
};

/** Codes whose `item` parameter is a skill. */
const SKILL_ITEM_CODES: ReadonlySet<string> = new Set(["alreadyExpert", "notProficient", "skillAlreadyGranted"]);

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

/** The message key of an issue: some codes have variants by the parameters the engine sends. */
function issueKey(issue: Issue): string {
  const { code, params } = issue;
  if (code === "requirementNotMet" && params["requirement"] === "proficiency") return "issue.requirementNotMet.proficiency";
  if (code === "wrongCount" && params["expected"] === undefined && params["max"] !== undefined) {
    return params["item"] === undefined ? "issue.wrongCount.max" : "issue.wrongCount.item";
  }
  return `issue.${code}`;
}

export function createI18n(lang: Lang): I18n {
  const table = TABLES[lang];
  const t: Translate = (key, params = {}) => (Object.hasOwn(table, key) ? interpolate(table[key] ?? key, params) : key);
  const issueMessage = (issue: Issue, names: NameOf) => {
    const shown: Record<string, string | number> = {};
    for (const [name, value] of Object.entries(issue.params)) {
      if (name === "source" && typeof value === "string") {
        // Where a granted skill comes from (race, subrace, background), worded by the interface.
        shown[name] = t(`issue.source.${value}`);
        continue;
      }
      if (name === "other" && typeof value === "string") {
        // Other characters, by their `who`: the player or an origin.
        shown[name] = value
          .split(", ")
          .map((who) => (who === "player" ? t("party.player") : names("origin", who)))
          .join(", ");
        continue;
      }
      const kind = name === "item" && SKILL_ITEM_CODES.has(issue.code) ? "skill" : NAMED_PARAMS[name];
      shown[name] =
        kind === undefined || typeof value !== "string"
          ? value
          : value
              .split(", ")
              .map((id) => names(kind, id))
              .join(", ");
    }
    // A placeholder the engine did not fill reads as an unknown value rather than a raw "{name}".
    return t(issueKey(issue), shown).replace(/\{\w+\}/g, "?");
  };
  return { lang, t, issueMessage };
}

export const I18nContext = createContext<I18n>(createI18n("en"));

export function useI18n(): I18n {
  return useContext(I18nContext);
}
