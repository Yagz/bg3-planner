/** The equipment slots a character fills, by the game's identifiers (texts `slot:<Id>`), in display order. */
export const EQUIPMENT_SLOTS = [
  "Helmet",
  "Cloak",
  "Breast",
  "Gloves",
  "Boots",
  "Amulet",
  "Ring",
  "Ring2",
  "Underwear",
  "MeleeMainHand",
  "MeleeOffHand",
  "RangedMainHand",
  "RangedOffHand",
  "MusicalInstrument",
  "VanityBody",
  "VanityBoots",
] as const;

export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export type Act = "1" | "2" | "3";

/**
 * The equipment slots an item of each data slot (`rules.items[*].slot`) goes to, in the order they are filled. The game data
 * does not hold this correspondence. Which light weapons may go to an off hand is the engine's judgement, not this table's.
 */
export const DATA_SLOT_TARGETS: Record<string, EquipmentSlot[]> = {
  "Melee Main Weapon": ["MeleeMainHand"],
  "Melee Offhand Weapon": ["MeleeOffHand"],
  "Ranged Main Weapon": ["RangedMainHand"],
  Ring: ["Ring", "Ring2"],
  Amulet: ["Amulet"],
  Boots: ["Boots"],
  Breast: ["Breast"],
  Cloak: ["Cloak"],
  Gloves: ["Gloves"],
  Helmet: ["Helmet"],
  MusicalInstrument: ["MusicalInstrument"],
  Underwear: ["Underwear"],
  VanityBody: ["VanityBody"],
  VanityBoots: ["VanityBoots"],
};
