import type { GameData, Selector, SelectSpells } from "../data/types.ts";
import { ABILITIES } from "../plan/model.ts";
import type { Ability } from "../plan/model.ts";
import { ABILITY_CAP } from "./abilities.ts";
import type { Issue, IssueCode } from "./issues.ts";
import type { SkillSource } from "./skills.ts";

/** A replacement in a `SelectSpells` choice is written `"old>new"`. */
export const SWAP_SEPARATOR = ">";

/** What a character has gained so far while its levels are walked in order. */
export type Known = {
  /**
   * Spells picked by `SelectSpells` per spell scope (a class, a race or subrace table, or one feat slot), minus the
   * swapped-out ones. Only these make a pick `alreadyKnown` and can be swapped out; `AddSpells` grants never do,
   * since whether the game also lets the player pick a granted spell is unverified.
   */
  spells: Map<string, Set<string>>;
  /** Passives currently held, by the list they were picked from (`SelectPassives`, then `ReplacePassives`). */
  passives: Map<string, string[]>;
  /** Skills picked by `SelectSkills`, and by a `SelectSkillsExpertise` that grants proficiency (`requires_proficiency` false). */
  skills: Set<string>;
  /** Skills picked by `SelectSkillsExpertise`; one picked where the selector grants proficiency is in `skills` too. */
  expertise: Set<string>;
};

export function emptyKnown(): Known {
  return { spells: new Map(), passives: new Map(), skills: new Set(), expertise: new Set() };
}

/** Every passive currently held from a picking selector. */
export function heldPassives(known: Known): string[] {
  return [...known.passives.values()].flat();
}

export type SlotContext = {
  data: GameData;
  character: string;
  /** Character level (1-based). */
  level: number;
  /** Spell scope of the slot: the level's class, `race:<table>` for a race or subrace row, or the feat slot. */
  scope: string;
  slot: string;
  /** Running ability scores, uncapped; ability choices add to them. */
  scores: Record<Ability, number>;
  known: Known;
  /** Skills granted without a pick by the race, subrace or background so far; a `SelectSkills` pick among them is a notice. Absent: no notice. */
  grantedSkills?: ReadonlyMap<string, SkillSource>;
  /** Skills the character is proficient in, for `SelectSkillsExpertise`. Absent: expertise is not checked against proficiency. */
  proficientSkills?: ReadonlySet<string>;
  /** Expertise granted without a pick (boosts of rows and passives), where proficient: a pick among them is `alreadyExpert`. */
  grantedExpertise?: ReadonlySet<string>;
};

function listItems(data: GameData, list: string): string[] {
  return Object.hasOwn(data.rules.lists, list) ? (data.rules.lists[list]?.items ?? []) : [];
}

function duplicates(entries: string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) repeated.add(entry);
    seen.add(entry);
  }
  return [...repeated];
}

/**
 * Checks a list-of-identifiers choice against its selector; records what it grants in `ctx`. Returns invalid issues, and
 * a `skillAlreadyGranted` notice for a skill pick the race, subrace or background already grants.
 */
export function checkChoice(selector: Selector, choice: string[], ctx: SlotContext): Issue[] {
  const issues: Issue[] = [];
  const invalid = (code: IssueCode, params: Issue["params"]) => {
    issues.push({ severity: "invalid", code, character: ctx.character, level: ctx.level, slot: ctx.slot, params });
  };
  const items = new Set(listItems(ctx.data, selector.list));
  /** Reports entries outside the list and duplicates; returns the entries that are in the list. */
  const inList = (entries: string[]): string[] => {
    for (const entry of entries) if (!items.has(entry)) invalid("notInList", { item: entry, list: selector.list });
    return entries.filter((entry) => items.has(entry));
  };
  const noDuplicates = (entries: string[]) => {
    for (const entry of duplicates(entries)) invalid("duplicateChoice", { item: entry });
  };
  const exactly = (count: number, expected: number) => {
    if (count !== expected) invalid("wrongCount", { count, expected });
  };

  switch (selector.function) {
    case "AddSpells":
      // A grant needs no choice; the caller rejects a choice made for it.
      break;
    case "SelectSpells":
      checkSpells(selector, choice, ctx, invalid, inList, noDuplicates, exactly);
      break;
    case "SelectAbilityBonus": {
      const valid = inList(choice);
      noDuplicates(choice);
      exactly(choice.length, selector.bonuses.length);
      if (issues.length === 0) {
        valid.forEach((ability, i) => {
          if (isAbility(ability)) ctx.scores[ability] += selector.bonuses[i] ?? 0;
        });
      }
      break;
    }
    case "SelectAbilities": {
      inList(choice);
      exactly(choice.length, selector.count);
      const increments = new Map<string, number>();
      for (const entry of choice) increments.set(entry, (increments.get(entry) ?? 0) + 1);
      for (const [ability, count] of increments) {
        if (count > selector.max) invalid("wrongCount", { item: ability, count, max: selector.max });
      }
      if (issues.length === 0) {
        for (const [ability, count] of increments) {
          if (!isAbility(ability)) continue;
          ctx.scores[ability] += count;
          if (ctx.scores[ability] > ABILITY_CAP) invalid("abilityAboveMax", { ability, value: ctx.scores[ability] });
        }
      }
      break;
    }
    case "SelectPassives": {
      const valid = inList(choice);
      noDuplicates(choice);
      exactly(choice.length, selector.count);
      const held = new Set(heldPassives(ctx.known));
      for (const entry of new Set(valid)) if (held.has(entry)) invalid("alreadyKnown", { item: entry });
      const fromList = ctx.known.passives.get(selector.list) ?? [];
      ctx.known.passives.set(selector.list, [...fromList, ...new Set(valid)]);
      break;
    }
    case "ReplacePassives": {
      // An optional change of a passive picked earlier from the same list; at most `count` replacements.
      const valid = inList(choice);
      noDuplicates(choice);
      if (choice.length > selector.count) invalid("wrongCount", { count: choice.length, max: selector.count });
      const fromList = ctx.known.passives.get(selector.list) ?? [];
      const incoming = [...new Set(valid)];
      for (const entry of incoming) if (fromList.includes(entry)) invalid("alreadyKnown", { item: entry });
      if (issues.length === 0 && incoming.length > 0) {
        // The latest picks give way to the replacements.
        ctx.known.passives.set(selector.list, [...fromList.slice(0, Math.max(0, fromList.length - incoming.length)), ...incoming]);
      }
      break;
    }
    case "SelectSkills": {
      const valid = inList(choice);
      noDuplicates(choice);
      exactly(choice.length, selector.count);
      for (const entry of new Set(valid)) if (ctx.known.skills.has(entry)) invalid("alreadyKnown", { item: entry });
      for (const entry of new Set(valid)) {
        const source = ctx.grantedSkills?.get(entry);
        if (source !== undefined) {
          issues.push({ severity: "notice", code: "skillAlreadyGranted", character: ctx.character, level: ctx.level, slot: ctx.slot, params: { item: entry, source } });
        }
      }
      for (const entry of valid) ctx.known.skills.add(entry);
      break;
    }
    case "SelectSkillsExpertise": {
      const valid = inList(choice);
      noDuplicates(choice);
      exactly(choice.length, selector.count);
      // `requires_proficiency` false (Knowledge Domain): the pick grants proficiency along with expertise.
      const grantsProficiency = selector.requires_proficiency === false;
      for (const entry of new Set(valid)) {
        if (ctx.known.expertise.has(entry) || ctx.grantedExpertise?.has(entry)) {
          invalid("alreadyExpert", { item: entry });
        } else if (!grantsProficiency && ctx.proficientSkills !== undefined && !ctx.proficientSkills.has(entry)) {
          invalid("notProficient", { item: entry });
        } else {
          ctx.known.expertise.add(entry);
          if (grantsProficiency) ctx.known.skills.add(entry);
        }
      }
      break;
    }
    case "SelectEquipment":
      inList(choice);
      noDuplicates(choice);
      exactly(choice.length, selector.count);
  }
  return issues;
}

function isAbility(entry: string): entry is Ability {
  return (ABILITIES as readonly string[]).includes(entry);
}

function checkSpells(
  selector: SelectSpells,
  choice: string[],
  ctx: SlotContext,
  invalid: (code: IssueCode, params: Issue["params"]) => void,
  inList: (entries: string[]) => string[],
  noDuplicates: (entries: string[]) => void,
  exactly: (count: number, expected: number) => void,
): void {
  const { known } = ctx;
  const picks = choice.filter((entry) => !entry.includes(SWAP_SEPARATOR));
  const swaps = choice
    .filter((entry) => entry.includes(SWAP_SEPARATOR))
    .map((entry) => {
      const cut = entry.indexOf(SWAP_SEPARATOR);
      return { old: entry.slice(0, cut), new: entry.slice(cut + SWAP_SEPARATOR.length) };
    });

  exactly(picks.length, selector.count);
  if (swaps.length > selector.swaps) invalid("tooManySwaps", { count: swaps.length, max: selector.swaps });

  const picked = known.spells.get(ctx.scope) ?? new Set<string>();
  known.spells.set(ctx.scope, picked);
  const swappable = swaps.filter((swap) => {
    if (picked.has(swap.old)) return true;
    invalid("swapNotKnown", { item: swap.old });
    return false;
  });

  const incoming = [...picks, ...swaps.map((swap) => swap.new)];
  const valid = inList(incoming);
  noDuplicates(incoming);
  for (const spell of new Set(valid)) if (picked.has(spell)) invalid("alreadyKnown", { item: spell });

  for (const swap of swappable) picked.delete(swap.old);
  for (const spell of valid) picked.add(spell);
}
