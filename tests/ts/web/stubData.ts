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
      spells: {},
    } as unknown as GameData["rules"],
    texts: { en, fr },
    meta: { game: "0.0.0.0", modules: [], notice: { en: "", fr: "" } },
    unlockedSubclasses: {},
    skills: {},
  };
}

export const text = (name: string) => ({ name, description: null });
