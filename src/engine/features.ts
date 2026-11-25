import type { GameData } from "../data/types.ts";
import type { ResolvedLevel } from "./progression.ts";

/** Something a level gives without a choice: a passive its rows add, or a spell of one of its `AddSpells` lists. */
export type Feature = { kind: "passive" | "spell"; id: string; level: number };

/** What a resolved level grants: its rows' added passives (technical ones left out), then their granted spells; each once. */
export function grantedFeatures(level: ResolvedLevel, data: GameData): Feature[] {
  const { lists, passives } = data.rules;
  const passiveIds = new Set<string>();
  const spellIds = new Set<string>();
  for (const row of level.rows) {
    for (const id of row.passives_added) if (!Object.hasOwn(passives, id) || passives[id]?.technical !== true) passiveIds.add(id);
  }
  for (const row of level.rows) {
    for (const selector of row.selectors) {
      if (selector.function !== "AddSpells") continue;
      for (const id of Object.hasOwn(lists, selector.list) ? (lists[selector.list]?.items ?? []) : []) spellIds.add(id);
    }
  }
  return [
    ...[...passiveIds].map((id): Feature => ({ kind: "passive", id, level: level.level })),
    ...[...spellIds].map((id): Feature => ({ kind: "spell", id, level: level.level })),
  ];
}
