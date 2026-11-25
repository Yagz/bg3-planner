import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Ability } from "../plan/model.ts";
import type { GameData, Meta, Rules, Texts, UnlockedSubclass } from "./types.ts";

async function readJson<T>(dir: string, file: string): Promise<T> {
  return JSON.parse(await readFile(join(dir, file), "utf-8")) as T;
}

/**
 * Read `rules.json`, `texts.en.json`, `texts.fr.json` and `meta.json` from a `data/larian` directory, and the
 * hand-written `unlocked_subclasses.json` and `skills.json` from its sibling `data/rules` (Node only).
 */
export async function loadGameData(dir: string): Promise<GameData> {
  const [rules, en, fr, meta, unlockedSubclasses, skills] = await Promise.all([
    readJson<Rules>(dir, "rules.json"),
    readJson<Texts>(dir, "texts.en.json"),
    readJson<Texts>(dir, "texts.fr.json"),
    readJson<Meta>(dir, "meta.json"),
    readJson<Record<string, UnlockedSubclass>>(join(dir, "..", "rules"), "unlocked_subclasses.json"),
    readJson<Record<string, Ability>>(join(dir, "..", "rules"), "skills.json"),
  ]);
  return { rules, texts: { en, fr }, meta, unlockedSubclasses, skills };
}
