import type { GameData, Requirement, Selector } from "../data/types.ts";
import type { Character, Run } from "../plan/model.ts";
import { abilityTotals, checkPointBuy } from "./abilities.ts";
import { checkChoice, emptyKnown, grantSpells } from "./choices.ts";
import { reportFrom } from "./issues.ts";
import type { Issue, Report } from "./issues.ts";
import { resolve, subclassSlot } from "./progression.ts";

export function featSlot(level: number): string {
  return `feat:${level}`;
}

/** Checks every character of a run: point buy, progression, then each choice slot. Never corrects anything. */
export function validate(run: Run, data: GameData): Report {
  return reportFrom(run.characters.flatMap((character) => validateCharacter(character, data)));
}

const PROFICIENCY = /^Proficiency\((\w+)\)$/;

function validateCharacter(character: Character, data: GameData): Issue[] {
  const { classes, feats, passives, lists } = data.rules;
  const issues: Issue[] = [...checkPointBuy(character)];
  const resolved = resolve(character, data);
  issues.push(...resolved.issues);

  const scores = { ...character.abilities };
  const known = emptyKnown();
  /** Proficiencies granted so far by `Proficiency(...)` boosts of rows, passives and feats. */
  const proficiencies = new Set<string>();
  const grant = (boosts: string[]) => {
    for (const boost of boosts) {
      const match = PROFICIENCY.exec(boost);
      if (match?.[1] !== undefined) proficiencies.add(match[1]);
    }
  };
  const grantPassives = (names: string[]) => {
    for (const name of names) if (Object.hasOwn(passives, name)) grant(passives[name]?.boosts ?? []);
  };
  const featsTaken = new Set<string>();

  for (const level of resolved.levels) {
    const n = level.level;
    const choices = character.levels[n - 1]?.choices ?? {};
    const issue = (severity: Issue["severity"], code: string, slot: string, params: Issue["params"] = {}) => {
      issues.push({ severity, code, character: character.id, level: n, slot, params });
    };
    const classResolved = Object.hasOwn(classes, level.class) && classes[level.class]?.parent === null;

    for (const row of level.rows) {
      grant(row.boosts);
      grantPassives(row.passives_added);
    }

    /** Slot ids this level offers; any other key in its choices is stale or hand-edited. */
    const open = new Set<string>();
    if (level.subclassChoice !== null) open.add(subclassSlot(level.class));

    const checkSlot = (slot: string, selector: Selector) => {
      if (selector.function === "AddSpells") return;
      open.add(slot);
      const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
      if (choice === undefined || choice === "todo") {
        issue("incomplete", "choiceMissing", slot, { selector: selector.function });
      } else if (!Array.isArray(choice)) {
        issue("notice", "offData", slot, { selector: selector.function });
      } else {
        const ctx = { data, character: character.id, level: n, class: level.class, slot, scores, known };
        issues.push(...checkChoice(selector, choice, ctx));
        if (selector.function === "SelectPassives" || selector.function === "ReplacePassives") {
          const offered = Object.hasOwn(lists, selector.list) ? (lists[selector.list]?.items ?? []) : [];
          grantPassives(choice.filter((name) => offered.includes(name)));
        }
      }
    };

    // A level's grants come together: they are known before its picks are checked.
    for (const slot of level.slots) if (slot.selector.function === "AddSpells") grantSpells(known, slot.selector, data);
    for (const slot of level.slots) checkSlot(slot.id, slot.selector);

    /** Checks the feat slot; returns the feat whose selectors open, or null. */
    const checkFeat = (slot: string): string | null => {
      const choice = Object.hasOwn(choices, slot) ? choices[slot] : undefined;
      if (choice === undefined || choice === "todo") {
        issue("incomplete", "choiceMissing", slot);
        return null;
      }
      if (!Array.isArray(choice)) {
        issue("notice", "offData", slot);
        return null;
      }
      if (choice.length !== 1) {
        issue("invalid", "wrongCount", slot, { count: choice.length, expected: 1 });
        return null;
      }
      const name = choice[0] ?? "";
      const def = Object.hasOwn(feats, name) ? feats[name] : undefined;
      if (def === undefined) {
        issue("invalid", "unknownFeat", slot, { feat: name });
        return null;
      }
      if (!def.repeatable && featsTaken.has(name)) issue("invalid", "featAlreadyTaken", slot, { feat: name });
      featsTaken.add(name);
      const totals = abilityTotals(character, data, n - 1);
      for (const requirement of def.requirements) {
        const unmet = unmetParams(requirement, totals, proficiencies);
        if (unmet !== null) issue("invalid", "requirementNotMet", slot, { feat: name, ...unmet });
      }
      return name;
    };

    if (level.featChoice) {
      const slot = featSlot(n);
      open.add(slot);
      const feat = checkFeat(slot);
      if (feat !== null) {
        const selectors = feats[feat]?.selectors ?? [];
        for (const selector of selectors) if (selector.function === "AddSpells") grantSpells(known, selector, data);
        selectors.forEach((selector, i) => checkSlot(`${slot}/${i}`, selector));
        // The feat's passives count for the feats of later levels only.
        grantPassives(feats[feat]?.passives ?? []);
      }
    }

    if (classResolved) {
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
