import type { Ability } from "../../../src/plan/model.ts";
import type { GameData, Meta, Rules, Texts, UnlockedSubclass } from "../../../src/data/types.ts";

/** Every data file the site fetches, relative to its base; the build copies them into the output. */
export const DATA_FILES = [
  "data/larian/rules.json",
  "data/larian/texts.en.json",
  "data/larian/texts.fr.json",
  "data/larian/meta.json",
  "data/rules/unlocked_subclasses.json",
  "data/rules/skills.json",
] as const;

/** Fetches the data files under `base` (the site's base URL) and assembles them as the Node loader does. */
export async function loadGameDataFromUrl(base: string, fetcher: typeof fetch = fetch): Promise<GameData> {
  const root = base.endsWith("/") ? base : `${base}/`;
  const get = async <T,>(file: (typeof DATA_FILES)[number]): Promise<T> => {
    const response = await fetcher(`${root}${file}`);
    if (!response.ok) throw new Error(`Could not load ${file}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };
  const [rules, en, fr, meta, unlockedSubclasses, skills] = await Promise.all([
    get<Rules>("data/larian/rules.json"),
    get<Texts>("data/larian/texts.en.json"),
    get<Texts>("data/larian/texts.fr.json"),
    get<Meta>("data/larian/meta.json"),
    get<Record<string, UnlockedSubclass>>("data/rules/unlocked_subclasses.json"),
    get<Record<string, Ability>>("data/rules/skills.json"),
  ]);
  return { rules, texts: { en, fr }, meta, unlockedSubclasses, skills };
}
