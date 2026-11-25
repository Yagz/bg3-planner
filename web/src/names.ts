import { bareNameOf, nameOf } from "../../src/data/names.ts";
import type { TextKind } from "../../src/data/names.ts";
import type { GameData } from "../../src/data/types.ts";
import type { Lang } from "./i18n/i18n.ts";

/** Display name of a game identifier in `lang` (`kind` null for a bare choice id); the identifier itself when there is none. */
export function gameName(data: GameData, lang: Lang, kind: TextKind | null, id: string): string {
  const texts = data.texts[lang];
  const name = kind === null ? bareNameOf(texts, id) : nameOf(texts, kind, id);
  return name === null || name.trim() === "" ? id : name;
}
