import type { GameData, Texts } from "../../../src/data/types.ts";

/** A tiny GameData: just enough tables and names for the shell; game names are placeholders, never real labels. */
export function stubData(en: Texts = {}, fr: Texts = {}): GameData {
  return {
    rules: {
      backgrounds: {},
      classes: {},
      feats: {},
      items: {},
      lists: {},
      origins: {},
      passives: {},
      progressions: [],
      races: {},
      rulesets: {},
      rulesetModifiers: {
        HONOUR_STATS: { type: "bool", default: false, custom: false },
        MULTICLASSING: { type: "bool", default: true, custom: true },
        PROFICIENCY_BONUS: { type: "int", default: 0, min: -1, max: 4, custom: true },
      },
      spells: {},
    } as unknown as GameData["rules"],
    texts: { en, fr },
    meta: { game: "0.0.0.0", modules: [], notice: { en: "", fr: "" } },
    unlockedSubclasses: {},
    skills: {},
  };
}

export const text = (name: string) => ({ name, description: null });
