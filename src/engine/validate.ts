import type { GameData, Requirement, Selector } from "../data/types.ts";
import { isOffData } from "../plan/model.ts";
import type { Character, Choice, Run } from "../plan/model.ts";
import { abilityTotals, checkPointBuy } from "./abilities.ts";
import { checkChoice, emptyKnown, heldPassives } from "./choices.ts";
import { rulesetEffects } from "./difficulty.ts";
import { reportFrom } from "./issues.ts";
import type { Issue, IssueCode, Report } from "./issues.ts";
import { resolve, subclassSlot } from "./progression.ts";
import type { ResolvedLevel } from "./progression.ts";
import { grantedSkills, passiveSkills, skillBoosts } from "./skills.ts";

export function featSlot(level: number): string {
  return `feat:${level}`;
}

/** A slot where a pick is made: its id, the selector it answers and the spell scope of its picks. */
export type SelectorSlot = { id: string; selector: Selector; scope: string };

/** The slots a character level offers, in the order `validate` checks them. */
export type LevelSlots = {
  /** Whether the level's class is a known base class: only then is a choice key outside these slots reported. */
  checked: boolean;
  /** `subclass:<class>` when the level requires choosing a subclass. */
  subclass: string | null;
  /** Picking slots of the level's rows (`AddSpells` grants are no slot). */
  selectors: SelectorSlot[];
  /** The feat slot when the level grants a feat; `feat` is the picked feat when the choice names exactly one known feat. */
  feat: { id: string; feat: string | null; selectors: SelectorSlot[] } | null;
};

/** Computes the slots of one resolved level; the feat's own slots open as soon as one known feat is picked. */
export function levelSlots(level: ResolvedLevel, choices: Record<string, Choice>, data: GameData): LevelSlots {
  const { classes, feats } = data.rules;
  // Race and subrace selectors pick spells in their own table's scope, apart from every class.
  const raceTables = new Map(level.rows.filter((row) => row.type === "race").map((row) => [row.uuid, row.table]));
  const selectors = level.slots
    .filter((slot) => slot.selector.function !== "AddSpells")
    .map((slot) => {
      const table = raceTables.get(slot.progression);
      return { id: slot.id, selector: slot.selector, scope: table === undefined ? level.class : `race:${table}` };
    });
  let feat: LevelSlots["feat"] = null;
  if (level.featChoice) {
    const id = featSlot(level.level);
    const choice = Object.hasOwn(choices, id) ? choices[id] : undefined;
    const name = Array.isArray(choice) && choice.length === 1 ? (choice[0] ?? "") : "";
    const picked = Object.hasOwn(feats, name) ? name : null;
    const featSelectors = picked === null ? [] : (feats[picked]?.selectors ?? []);
    const featSlots = featSelectors.flatMap((selector, i) => (selector.function === "AddSpells" ? [] : [{ id: `${id}/${i}`, selector, scope: id }]));
    feat = { id, feat: picked, selectors: featSlots };
  }
  return {
    checked: Object.hasOwn(classes, level.class) && classes[level.class]?.parent === null,
    subclass: level.subclassChoice === null ? null : subclassSlot(level.class),
    selectors,
    feat,
  };
}

/** Whether a picking slot may stay unset: nothing to pick (`count` 0) or an optional replacement. A pick made there is still checked. */
export function isOptionalSelector(selector: Selector): boolean {
  return selector.function === "ReplacePassives" || ("count" in selector && selector.count === 0);
}

/** The picking slots of a level that must be answered (not optional), in the order `validate` checks them. */
export function requiredSelectors(slots: LevelSlots): SelectorSlot[] {
  return slots.selectors.filter(({ selector }) => !isOptionalSelector(selector));
}

/** Every slot id of a level where a choice may be stored. */
export function slotIds(slots: LevelSlots): Set<string> {
  const ids = new Set<string>();
  if (slots.subclass !== null) ids.add(slots.subclass);
  for (const slot of slots.selectors) ids.add(slot.id);
  if (slots.feat !== null) {
    ids.add(slots.feat.id);
    for (const slot of slots.feat.selectors) ids.add(slot.id);
  }
  return ids;
}

/**
 * Spells picked by `SelectSpells` in `scope` (see `SelectorSlot.scope`) over the levels before `level`, after their swaps,
 * in the order they were gained: what a swap at `level` may replace. Unusable picks are skipped as `validate` skips them.
 */
export function knownSpellsBefore(character: Character, data: GameData, level: number, scope: string): string[] {
  const known = emptyKnown();
  const scores = { ...character.abilities };
  for (const resolved of resolve(character, data).levels) {
    if (resolved.level >= level) break;
    const choices = character.levels[resolved.level - 1]?.choices ?? {};
    const slots = levelSlots(resolved, choices, data);
    for (const { id, selector, scope: slotScope } of [...slots.selectors, ...(slots.feat?.selectors ?? [])]) {
      const choice = Object.hasOwn(choices, id) ? choices[id] : undefined;
      if (selector.function !== "SelectSpells" || slotScope !== scope || !Array.isArray(choice)) continue;
      checkChoice(selector, choice, { data, character: character.id, level: resolved.level, scope, slot: id, scores, known });
    }
  }
  return [...(known.spells.get(scope) ?? [])];
}

/**
 * Checks every character of a run: point buy, progression, each choice slot, then the multiclass levels the run's ruleset
 * forbids. Never corrects anything.
 */
export function validate(run: Run, data: GameData): Report {
  const { multiclass } = rulesetEffects(run.difficulty, data);
  return reportFrom(run.characters.flatMap((character) => [...validateCharacter(character, data), ...(multiclass ? [] : multiclassLevels(character))]));
}

/** Each level after the first whose class names a class (known or not) other than level 1's; an undecided or off-data class on either side is never flagged. */
function multiclassLevels(character: Character): Issue[] {
  const first = character.levels[0]?.class;
  if (typeof first !== "string" || first === "") return [];
  return character.levels.flatMap(({ class: cls }, i): Issue[] =>
    i > 0 && typeof cls === "string" && cls !== "" && cls !== first
      ? [{ severity: "invalid", code: "multiclassDisabled", character: character.id, level: i + 1, slot: null, params: { class: cls } }]
      : [],
  );
}

const PROFICIENCY = /^Proficiency\((\w+)\)$/;

function validateCharacter(character: Character, data: GameData): Issue[] {
  const { feats, passives } = data.rules;
  const issues: Issue[] = [...checkPointBuy(character)];
  const resolved = resolve(character, data);
  issues.push(...resolved.issues);

  const scores = { ...character.abilities };
  const known = emptyKnown();
  /** Proficiencies granted so far by `Proficiency(...)` boosts of rows, their passives and feats' passives. */
  const granted = new Set<string>();
  const grant = (boosts: string[], into: Set<string>) => {
    for (const boost of boosts) {
      const match = PROFICIENCY.exec(boost);
      if (match?.[1] !== undefined) into.add(match[1]);
    }
  };
  const grantPassives = (names: string[], into: Set<string>) => {
    for (const name of names) if (Object.hasOwn(passives, name)) grant(passives[name]?.boosts ?? [], into);
  };
  /** Granted proficiencies plus those of the passives currently held from picks (a replaced passive stops counting). */
  const proficiencies = (): Set<string> => {
    const all = new Set(granted);
    grantPassives(heldPassives(known), all);
    return all;
  };
  const featsTaken = new Set<string>();
  /** Skills granted without a pick so far: the background's passives, then the boosts and passives of rows and feats. */
  const skillsGranted = new Set<string>();
  const { background } = character;
  if (!isOffData(background) && Object.hasOwn(data.rules.backgrounds, background)) {
    for (const skill of passiveSkills(data, data.rules.backgrounds[background]?.passives ?? [])) skillsGranted.add(skill);
  }
  /** Skills the character is proficient in now: picked, granted, or from the passives currently held from picks. */
  const proficientSkills = (): Set<string> => new Set([...known.skills, ...skillsGranted, ...passiveSkills(data, heldPassives(known))]);

  for (const level of resolved.levels) {
    const n = level.level;
    const choices = character.levels[n - 1]?.choices ?? {};
    const issue = (severity: Issue["severity"], code: IssueCode, slot: string, params: Issue["params"] = {}) => {
      issues.push({ severity, code, character: character.id, level: n, slot, params });
    };
    const slots = levelSlots(level, choices, data);

    for (const row of level.rows) {
      grant(row.boosts, granted);
      grantPassives(row.passives_added, granted);
      for (const skill of [...skillBoosts(row.boosts).proficient, ...passiveSkills(data, row.passives_added)]) skillsGranted.add(skill);
    }
    const levelGranted = grantedSkills(character, data, n);
    /** Expertise slots of the level (feat ones included), checked last: a skill gained anywhere in the level counts. */
    const expertiseSlots: SelectorSlot[] = [];

    const checkSlot = ({ id: slot, selector, scope }: SelectorSlot) => {
      const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
      if (choice === undefined && isOptionalSelector(selector)) {
        // Nothing to pick, or an optional replacement: leaving the key out keeps what is held.
      } else if (choice === undefined || choice === "todo") {
        issue("incomplete", "choiceMissing", slot, { selector: selector.function });
      } else if (!Array.isArray(choice)) {
        issue("notice", "offData", slot, { selector: selector.function });
      } else {
        const ctx = { data, character: character.id, level: n, scope, slot, scores, known, grantedSkills: levelGranted, proficientSkills: proficientSkills() };
        issues.push(...checkChoice(selector, choice, ctx));
      }
    };

    /** Checks a slot now, or keeps an expertise slot for the end of the level. */
    const visit = (slot: SelectorSlot) => {
      if (slot.selector.function === "SelectSkillsExpertise") expertiseSlots.push(slot);
      else checkSlot(slot);
    };

    slots.selectors.forEach(visit);

    /** Checks the feat slot; the feat's own slots open when it names exactly one known feat (`slots.feat.feat`). */
    const checkFeat = (slot: string, name: string | null) => {
      const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
      if (choice === undefined || choice === "todo") {
        issue("incomplete", "choiceMissing", slot);
      } else if (!Array.isArray(choice)) {
        issue("notice", "offData", slot);
      } else if (choice.length !== 1) {
        issue("invalid", "wrongCount", slot, { count: choice.length, expected: 1 });
      } else if (name === null) {
        issue("invalid", "unknownFeat", slot, { feat: choice[0] ?? "" });
      } else {
        const def = feats[name];
        if (!def?.repeatable && featsTaken.has(name)) issue("invalid", "featAlreadyTaken", slot, { feat: name });
        featsTaken.add(name);
        const totals = abilityTotals(character, data, n - 1);
        const held = proficiencies();
        for (const requirement of def?.requirements ?? []) {
          const unmet = unmetParams(requirement, totals, held);
          if (unmet !== null) issue("invalid", "requirementNotMet", slot, { feat: name, ...unmet });
        }
      }
    };

    if (slots.feat !== null) {
      checkFeat(slots.feat.id, slots.feat.feat);
      if (slots.feat.feat !== null) {
        slots.feat.selectors.forEach(visit);
        // The feat's passives count for the feats of later levels only.
        grantPassives(feats[slots.feat.feat]?.passives ?? [], granted);
        for (const skill of passiveSkills(data, feats[slots.feat.feat]?.passives ?? [])) skillsGranted.add(skill);
      }
    }

    expertiseSlots.forEach(checkSlot);

    // Any key outside the level's slots is stale or hand-edited.
    if (slots.checked) {
      const open = slotIds(slots);
      for (const key of Object.keys(choices)) if (!open.has(key)) issue("invalid", "unknownSlot", key);
    }
  }
  return issues;
}

function unmetParams(requirement: Requirement, totals: Record<string, number>, proficiencies: Set<string>): Issue["params"] | null {
  if (requirement.type === "ability_min") {
    const actual = totals[requirement.ability] ?? 0;
    return actual >= requirement.value ? null : { requirement: requirement.type, ability: requirement.ability, value: requirement.value, actual };
  }
  return proficiencies.has(requirement.proficiency) ? null : { requirement: requirement.type, proficiency: requirement.proficiency };
}
