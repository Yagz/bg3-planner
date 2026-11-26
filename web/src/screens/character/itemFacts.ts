import type { GameData } from "../../../../src/data/types.ts";
import { itemRarity } from "../../../../src/engine/equipment.ts";
import type { Translate } from "../../i18n/i18n.ts";

const ACT_RANK: Record<string, number> = { prologue: 0, one: 1, two: 2, three: 3 };

/** The style class of a rarity (`r-veryrare`); none for a rarity without a colour (`story`) or without wiki data. */
export function rarityClass(rarity: string | null): string {
  return rarity === null || rarity === "story" ? "" : `r-${rarity.replace(" ", "")}`;
}

/** The interface name of a rarity of bg3.wiki; the raw value when the interface has no word for it. */
export function rarityName(t: Translate, rarity: string): string {
  const key = `equipment.rarity.${rarity.replace(" ", "")}`;
  const name = t(key);
  return name === key ? rarity : name;
}

/** Where bg3.wiki places an item, earliest act first ("Act 2 · Blighted Village"); `all` lists every location, else the first with a count of the others; the interface's "unknown" when the wiki has none. */
export function whereText(data: GameData, t: Translate, itemId: string, all = false): string {
  const locations = Object.hasOwn(data.wiki, itemId) ? (data.wiki[itemId]?.locations ?? []) : [];
  if (locations.length === 0) return t("equipment.unknownLocation");
  const ordered = [...locations].sort((a, b) => (a.act === null ? 9 : (ACT_RANK[a.act] ?? 9)) - (b.act === null ? 9 : (ACT_RANK[b.act] ?? 9)));
  const text = ({ act, location }: (typeof ordered)[number]) => (act === null || !Object.hasOwn(ACT_RANK, act) ? location : `${t(`equipment.actName.${act}`)} · ${location}`);
  if (all) return ordered.map(text).join("; ");
  return ordered.length === 1 ? text(ordered[0]!) : t("equipment.moreLocations", { where: text(ordered[0]!), count: ordered.length - 1 });
}

/** The rarity of an item and its style class together. */
export function rarityOf(data: GameData, itemId: string): { rarity: string | null; className: string } {
  const rarity = itemRarity(itemId, data);
  return { rarity, className: rarityClass(rarity) };
}
