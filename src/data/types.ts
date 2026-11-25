// Types of the produced game data (`data/larian/*.json`). They mirror the JSON exactly; see
// `scripts/data/model.py` and `scripts/data/selectors.py`. Everything is keyed by the game's internal identifier.

import type { Ability } from "../plan/model.ts";

export interface ClassDef {
  uuid: string;
  /** UUID of the progression table. */
  table: string;
  /** Base class `Name` for a subclass, null for a base class. */
  parent: string | null;
  base_hp: number | null;
  hp_per_level: number | null;
  multiclass_modifier: number | null;
  primary_ability: string;
  spellcasting_ability: string | null;
  /** UUID of a spell list. */
  spell_list: string | null;
  prepares_spells: boolean;
}

export interface RaceDef {
  uuid: string;
  /** UUID of the progression table. */
  table: string;
  /** Race `Name` for a subrace, null for a base race. */
  parent: string | null;
}

export interface BackgroundDef {
  origin: boolean;
  passives: string[];
}

export type Requirement =
  | { type: "ability_min"; ability: string; value: number }
  | { type: "proficiency"; proficiency: string };

export interface FeatDef {
  uuid: string;
  passives: string[];
  repeatable: boolean;
  requirements: Requirement[];
  selectors: Selector[];
}

export interface AddSpells {
  function: "AddSpells";
  list: string;
  id: string | null;
  ability: string | null;
  resource: string | null;
  prepare: string | null;
  cooldown: string | null;
}

export interface SelectSpells {
  function: "SelectSpells";
  list: string;
  count: number;
  swaps: number;
  id: string | null;
  ability: string | null;
  resource: string | null;
  prepare: string | null;
  cooldown: string | null;
  class: string | null;
}

export interface SelectPassives {
  function: "SelectPassives";
  list: string;
  count: number;
  id: string | null;
}

export interface ReplacePassives {
  function: "ReplacePassives";
  list: string;
  count: number;
  id: string;
}

export interface SelectSkills {
  function: "SelectSkills";
  list: string;
  count: number;
  id: string | null;
}

export interface SelectSkillsExpertise {
  function: "SelectSkillsExpertise";
  list: string;
  count: number;
  requires_proficiency: boolean | null;
  id: string | null;
}

export interface SelectAbilities {
  function: "SelectAbilities";
  list: string;
  count: number;
  max: number;
  id: string;
}

export interface SelectAbilityBonus {
  function: "SelectAbilityBonus";
  list: string;
  id: string;
  bonuses: number[];
}

export interface SelectEquipment {
  function: "SelectEquipment";
  list: string;
  count: number;
  id: string;
}

export type Selector =
  | AddSpells
  | SelectSpells
  | SelectPassives
  | ReplacePassives
  | SelectSkills
  | SelectSkillsExpertise
  | SelectAbilities
  | SelectAbilityBonus
  | SelectEquipment;

export interface Progression {
  uuid: string;
  /** UUID of the progression table this row belongs to. */
  table: string;
  level: number;
  type: "class" | "subclass" | "race";
  name: string;
  /** Row used when the class is taken after character level 1. */
  multiclass: boolean;
  feat: boolean;
  boosts: string[];
  passives_added: string[];
  passives_removed: string[];
  selectors: Selector[];
  /** Subclass `Name`s offered by this row (non-empty on a subclass-choice row). */
  subclasses: string[];
}

export interface ChoiceList {
  name: string;
  type: "spells" | "passives" | "skills" | "abilities" | "equipment";
  items: string[];
}

export interface SpellDef {
  type: string;
  level: number | null;
  school: string | null;
}

export interface PassiveDef {
  boosts: string[];
  /** An engine helper the interface hides (listed in `scripts/data/technical_passives.txt`); absent otherwise. */
  technical?: boolean;
}

/** A predefined character (`Origins.lsx`); references are rules keys, null when the origin sets none. */
export interface OriginDef {
  class: string | null;
  subclass: string | null;
  race: string | null;
  subrace: string | null;
  /** Background UUID. */
  background: string | null;
  lockRace: boolean;
  /** Whether the game's character creation screen offers the origin to the player (`AvailableInCharacterCreation`). */
  playable: boolean;
  /** Default base scores: the ability preset of the subclass if any, else of the class; null without a class. */
  abilities: Record<Ability, number> | null;
}

/** The ruleset modifiers that shape a build (`RulesetModifiers.lsx`). */
export type BuildModifier = "MULTICLASSING" | "PROFICIENCY_BONUS" | "HONOUR_STATS";

/** A ruleset the game's custom-mode screen shows (`Rulesets.lsx`), with its values for the build modifiers; a modifier without a value keeps its default. */
export interface RulesetDef {
  /** Position among the shown rulesets in the game's file (the produced JSON sorts its keys). */
  order: number;
  values: Partial<Record<BuildModifier, boolean | number>>;
}

export interface RulesetModifierDef {
  type: "bool" | "int";
  default: boolean | number;
  min?: number;
  max?: number;
  /** Whether the game's custom-mode screen shows the modifier. */
  custom: boolean;
}

export interface ItemDef {
  kind: "weapon" | "equipment";
  found_by: "stats" | "template";
  rarity: string | null;
  root_template: string;
  slot: string;
  stats_type: string;
}

export interface Rules {
  /** Keyed by `Name`; base classes and subclasses together. */
  classes: Record<string, ClassDef>;
  /** Keyed by `Name`; base races and subraces together. */
  races: Record<string, RaceDef>;
  /** Keyed by UUID. */
  backgrounds: Record<string, BackgroundDef>;
  /** Keyed by `Name`. */
  feats: Record<string, FeatDef>;
  progressions: Progression[];
  /** Keyed by UUID. */
  lists: Record<string, ChoiceList>;
  spells: Record<string, SpellDef>;
  passives: Record<string, PassiveDef>;
  items: Record<string, ItemDef>;
  /** Keyed by origin `Name`. */
  origins: Record<string, OriginDef>;
  /** Keyed by ruleset `Name`. */
  rulesets: Record<string, RulesetDef>;
  rulesetModifiers: Record<BuildModifier, RulesetModifierDef>;
}

/** Translations keyed by `<kind>:<identifier>` (e.g. `background:<uuid>`). */
export type Texts = Record<string, { name: string; description: string | null }>;

export interface Meta {
  game: string;
  modules: string[];
  notice: { en: string; fr: string };
}

/** A subclass the game unlocks during play, offered by no progression row (hand-written, `data/rules/`). */
export interface UnlockedSubclass {
  parent: string;
  reason: string;
  source: string;
}

export interface GameData {
  rules: Rules;
  texts: { en: Texts; fr: Texts };
  meta: Meta;
  /** Keyed by subclass name; from the hand-written `data/rules/unlocked_subclasses.json` (sibling of `data/larian/`), which any loader must read too. */
  unlockedSubclasses: Record<string, UnlockedSubclass>;
  /** Skill identifier -> ability; from the hand-written `data/rules/skills.json`, which any loader must read too. */
  skills: Record<string, Ability>;
}
