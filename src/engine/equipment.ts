import type { GameData, ItemDef } from "../data/types.ts";
import { DATA_SLOT_TARGETS, EQUIPMENT_SLOTS } from "../plan/equipmentSlots.ts";
import type { Act, EquipmentSlot } from "../plan/equipmentSlots.ts";
import type { Character, Run } from "../plan/model.ts";
import type { Issue, IssueCode } from "./issues.ts";
import { resolve } from "./progression.ts";

const ACTS: Act[] = ["1", "2", "3"];
const SLOT_SET: ReadonlySet<string> = new Set(EQUIPMENT_SLOTS);

/** The item a slot holds in an act once inheritance is applied, and where it comes from. */
export type EffectiveSlot = {
  item: string | null;
  /** The act that set the value; `"level"` for the instrument of a `SelectEquipment` pick (with its character `level`); null when nothing sets it. */
  source: Act | "level" | null;
  level?: number;
};

function itemDef(itemId: string, data: GameData): ItemDef | null {
  return Object.hasOwn(data.rules.items, itemId) ? (data.rules.items[itemId] ?? null) : null;
}

/** The first instrument picked by a `SelectEquipment` slot (the Bard's), with the character level of the pick; other picks (a Bladesinger's weapon) are no instrument. */
function instrumentPick(character: Character, data: GameData): { item: string; level: number } | null {
  for (const level of resolve(character, data).levels) {
    const choices = character.levels[level.level - 1]?.choices ?? {};
    for (const slot of level.slots) {
      if (slot.selector.function !== "SelectEquipment") continue;
      const choice = Object.hasOwn(choices, slot.id) ? choices[slot.id] : undefined;
      if (!Array.isArray(choice) || choice.length !== 1 || typeof choice[0] !== "string") continue;
      if (itemDef(choice[0], data)?.slot === "MusicalInstrument") return { item: choice[0], level: level.level };
    }
  }
  return null;
}

/**
 * Every equipment slot of a character in `act`: a slot an act does not set keeps the previous act's value, `null` empties
 * it on purpose. The Bard's instrument pick fills `MusicalInstrument` while no act up to this one sets that slot.
 */
export function effectiveEquipment(character: Character, act: Act, data: GameData): Record<EquipmentSlot, EffectiveSlot> {
  const result = {} as Record<EquipmentSlot, EffectiveSlot>;
  const upTo = ACTS.slice(0, ACTS.indexOf(act) + 1);
  for (const slot of EQUIPMENT_SLOTS) {
    let effective: EffectiveSlot = { item: null, source: null };
    for (const a of upTo) {
      const stored = character.equipment?.[a] ?? {};
      if (!Object.hasOwn(stored, slot)) continue;
      const value: unknown = stored[slot];
      effective = { item: typeof value === "string" ? value : null, source: a };
    }
    result[slot] = effective;
  }
  if (result.MusicalInstrument.source === null) {
    const pick = instrumentPick(character, data);
    if (pick !== null) result.MusicalInstrument = { item: pick.item, source: "level", level: pick.level };
  }
  return result;
}

/** Whether the character takes the `DualWielder` feat at any of its levels (acts and levels are not linked in the format). */
function hasDualWielder(character: Character, data: GameData): boolean {
  return resolve(character, data).levels.some((level) => {
    if (!level.featChoice) return false;
    const choices = character.levels[level.level - 1]?.choices ?? {};
    const key = `feat:${level.level}`;
    const choice = Object.hasOwn(choices, key) ? choices[key] : undefined;
    return Array.isArray(choice) && choice.includes("DualWielder");
  });
}

/**
 * The slots an item may go to: its data slot's targets, plus the off hands. `MeleeOffHand` takes light melee weapons, or
 * with `DualWielder` any melee weapon that is not two-handed; `RangedOffHand` takes light ranged weapons.
 */
function slotsOf(def: ItemDef, dualWielder: boolean): EquipmentSlot[] {
  const slots = Object.hasOwn(DATA_SLOT_TARGETS, def.slot) ? [...(DATA_SLOT_TARGETS[def.slot] ?? [])] : [];
  const light = def.properties.includes("Light");
  if (def.slot === "Melee Main Weapon" && (light || (dualWielder && !def.properties.includes("Twohanded")))) slots.push("MeleeOffHand");
  if (def.slot === "Ranged Main Weapon" && light) slots.push("RangedOffHand");
  return slots;
}

/** The equipment slots an item may go to for this character; empty for an id outside the game data. */
export function eligibleSlots(itemId: string, character: Character, data: GameData): EquipmentSlot[] {
  const def = itemDef(itemId, data);
  return def === null ? [] : slotsOf(def, hasDualWielder(character, data));
}

/** Every item the character may put in `slot`, in data order (sorting by name is the screen's job). */
export function itemsForSlot(slot: EquipmentSlot, character: Character, data: GameData): string[] {
  const dualWielder = hasDualWielder(character, data);
  return Object.entries(data.rules.items)
    .filter(([, def]) => slotsOf(def, dualWielder).includes(slot))
    .map(([id]) => id);
}

const WIKI_ACTS: Record<string, 1 | 2 | 3> = { prologue: 1, one: 1, two: 2, three: 3 };

/** The earliest act where bg3.wiki places the item (its prologue counts as act 1); null without a located act. */
export function itemFirstAct(itemId: string, data: GameData): 1 | 2 | 3 | null {
  if (!Object.hasOwn(data.wiki, itemId)) return null;
  let first: 1 | 2 | 3 | null = null;
  for (const { act } of data.wiki[itemId]?.locations ?? []) {
    const n = act !== null && Object.hasOwn(WIKI_ACTS, act) ? WIKI_ACTS[act] : undefined;
    if (n !== undefined && (first === null || n < first)) first = n;
  }
  return first;
}

/** The item's rarity on bg3.wiki (`common`, `very rare`…); null without wiki data. */
export function itemRarity(itemId: string, data: GameData): string | null {
  return Object.hasOwn(data.wiki, itemId) ? (data.wiki[itemId]?.rarity ?? null) : null;
}

/** A weapon that needs both hands: two-handed and not versatile. */
function twoHanded(def: ItemDef | null): boolean {
  return def !== null && def.properties.includes("Twohanded") && !def.properties.includes("Versatile");
}

const HANDS: [EquipmentSlot, EquipmentSlot][] = [
  ["MeleeMainHand", "MeleeOffHand"],
  ["RangedMainHand", "RangedOffHand"],
];

const equipmentSlot = (act: string, slot: string) => `equipment:${act}/${slot}`;

/**
 * Checks the equipment of every character. Stored values: an unknown slot key or item id is invalid, where it is written.
 * Effective values per act: an item in a slot it cannot go to, found only in a later act, held by another character in
 * the same act (rarity above common), or in an off hand beside a two-handed weapon is a notice, reported at the first act
 * where it holds and again only after it stopped holding or its values changed.
 */
export function equipmentIssues(run: Run, data: GameData): Issue[] {
  const issues: Issue[] = [];
  const issue = (severity: Issue["severity"], code: IssueCode, character: string, slot: string, params: Issue["params"]) => {
    issues.push({ severity, code, character, level: null, slot, params });
  };

  for (const character of run.characters) {
    for (const act of ACTS) {
      for (const [key, value] of Object.entries(character.equipment?.[act] ?? {})) {
        if (!SLOT_SET.has(key)) issue("invalid", "unknownEquipmentSlot", character.id, equipmentSlot(act, key), { slot: key });
        else if (typeof value === "string" && itemDef(value, data) === null) issue("invalid", "unknownItem", character.id, equipmentSlot(act, key), { item: value });
      }
    }
  }

  const effective = new Map(run.characters.map((c) => [c.id, ACTS.map((act) => effectiveEquipment(c, act, data))]));
  const dualWielders = new Map(run.characters.map((c) => [c.id, hasDualWielder(c, data)]));
  /** Keys of the notices that held in the previous act: one still holding with the same values is not reported again. */
  let previous = new Set<string>();
  ACTS.forEach((act, index) => {
    const current = new Set<string>();
    const notice = (code: IssueCode, character: string, slot: EquipmentSlot, params: Issue["params"]) => {
      const key = JSON.stringify([code, character, slot, params]);
      current.add(key);
      if (!previous.has(key)) issue("notice", code, character, equipmentSlot(act, slot), { ...params, act: Number(act) });
    };
    /** Item -> holders in this act, in run order (each character once, at its first slot). */
    const holders = new Map<string, { character: Character; slot: EquipmentSlot }[]>();

    for (const character of run.characters) {
      const slots = effective.get(character.id)?.[index];
      if (slots === undefined) continue;
      const dualWielder = dualWielders.get(character.id) ?? false;
      for (const slot of EQUIPMENT_SLOTS) {
        const { item, source } = slots[slot];
        if (item === null) continue;
        const def = itemDef(item, data);
        if (def === null) continue;
        if (!slotsOf(def, dualWielder).includes(slot)) notice("itemWrongSlot", character.id, slot, { item, slot });
        const found = itemFirstAct(item, data);
        if (source !== "level" && found !== null && found > Number(act)) notice("itemFoundLater", character.id, slot, { item, foundAct: found });
        const list = holders.get(item) ?? [];
        if (!list.some((h) => h.character.id === character.id)) list.push({ character, slot });
        holders.set(item, list);
      }
      for (const [main, off] of HANDS) {
        const weapon = slots[main].item;
        if (weapon !== null && slots[off].item !== null && twoHanded(itemDef(weapon, data))) notice("offHandWithTwoHanded", character.id, off, { item: weapon });
      }
    }

    for (const [item, list] of holders) {
      const rarity = itemRarity(item, data);
      if (list.length < 2 || rarity === null || rarity === "common") continue;
      for (const { character, slot } of list) {
        const other = list.filter((h) => h.character.id !== character.id).map((h) => h.character.who).join(", ");
        notice("itemSharedInAct", character.id, slot, { item, other });
      }
    }
    previous = current;
  });
  return issues;
}
