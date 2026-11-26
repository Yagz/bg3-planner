import { bareNameOf, descriptionOf, nameOf } from "../../src/data/names.ts";
import type { ParamFormat, TextKind } from "../../src/data/names.ts";
import type { GameData } from "../../src/data/types.ts";
import { createI18n } from "./i18n/i18n.ts";
import type { Lang } from "./i18n/i18n.ts";

/** Display name of a game identifier in `lang` (`kind` null for a bare choice id); the identifier itself when there is none. */
export function gameName(data: GameData, lang: Lang, kind: TextKind | null, id: string): string {
  const texts = data.texts[lang];
  const name = kind === null ? bareNameOf(texts, id) : nameOf(texts, kind, id);
  return name === null || name.trim() === "" ? id : name;
}

/** Description of a game identifier in `lang` as plain text, or null when the translation table has none. */
export function gameDescription(data: GameData, lang: Lang, kind: TextKind, id: string): string | null {
  const texts = data.texts[lang];
  const params = kind === "spell" ? data.rules.spells[id]?.params : kind === "passive" ? data.rules.passives[id]?.params : undefined;
  const format: ParamFormat = {
    lang,
    damageName: (type) => nameOf(texts, "damage", type),
    variable: createI18n(lang).t("description.variable"),
  };
  return descriptionOf(texts, kind, id, params, format);
}

/** Label of a character: its origin's name for a companion, `playerLabel` for the player. */
export function characterLabel(data: GameData, lang: Lang, who: string, playerLabel: string): string {
  return who === "player" ? playerLabel : gameName(data, lang, "origin", who);
}
