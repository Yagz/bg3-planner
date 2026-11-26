import type { GameData } from "../../../src/data/types.ts";
import rules from "../../../data/larian/rules.json";
import en from "../../../data/larian/texts.en.json";
import fr from "../../../data/larian/texts.fr.json";
import meta from "../../../data/larian/meta.json";
import unlockedSubclasses from "../../../data/rules/unlocked_subclasses.json";
import skills from "../../../data/rules/skills.json";
import wikiItems from "../../../data/wiki/items.json";

/** The committed game data, imported as JSON so the web type-check needs no Node types. */
export function realData(): GameData {
  return { rules, texts: { en, fr }, meta, unlockedSubclasses, skills, wiki: wikiItems.items } as unknown as GameData;
}
