import { useId, useState } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import { POINT_BUY, abilityTotals, pointsSpent } from "../../../../src/engine/abilities.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { ABILITIES } from "../../../../src/plan/model.ts";
import type { Ability, Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import { clearChoice } from "../../state/characterOps.ts";
import IssueList from "./IssueList.tsx";

/** Engine issue codes about the base scores themselves, shown in the Abilities frame. */
const SCORE_ISSUES: readonly string[] = ["abilityOutOfRange", "pointBuyOverBudget", "pointBuyUnderBudget"];

/** Whether an engine issue about no level in particular belongs to the Abilities frame rather than to the creation block. */
export function isScoreIssue(issue: Issue): boolean {
  return issue.level === null && issue.slot === null && SCORE_ISSUES.includes(issue.code);
}

/** The level-1 ability bonus slot (the first `SelectAbilityBonus` of resolved level 1) with its bonuses (`[2, 1]`); null without one, as when the level-1 class is not chosen. */
export function levelOneBonusSlot(character: Character, data: GameData): { id: string; bonuses: number[] } | null {
  const slot = resolve(character, data).levels[0]?.slots.find((s) => s.selector.function === "SelectAbilityBonus");
  return slot === undefined || slot.selector.function !== "SelectAbilityBonus" ? null : { id: slot.id, bonuses: slot.selector.bonuses };
}

const isAbility = (entry: unknown): entry is Ability => (ABILITIES as readonly unknown[]).includes(entry);

/** The signed modifier of a score. */
const modifier = (score: number): string => {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
};

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues (all of them): the frame keeps those about the scores and about its bonus slot. */
  issues: Issue[];
  onBase: (ability: Ability, value: number) => void;
  /** Called with the level-1 bonus slot and the abilities `[+2, +1]`, once both are chosen. */
  onBonus: (slot: string, choice: string[]) => void;
};

/** The abilities table: base score (point buy), the level-1 +2 and +1 as radio columns, the total at level 1 and the modifier. */
export default function Abilities({ data, character, issues, onBase, onBonus }: Props) {
  const { t, lang } = useI18n();
  const group = useId();
  const slot = levelOneBonusSlot(character, data);
  const stored = slot === null ? undefined : character.levels[0]?.choices[slot.id];
  const storedPair: (Ability | null)[] = Array.isArray(stored) && stored.length === 2 && stored.every(isAbility) ? stored : [null, null];
  /** A bonus chosen on its own stays here until the other is chosen too. */
  const [half, setHalf] = useState<(Ability | null)[] | null>(null);
  const picked = half ?? storedPair;
  const complete = picked[0] !== null && picked[1] !== null;
  const bonuses = slot?.bonuses ?? [2, 1];
  const spent = pointsSpent(character.abilities);

  // The total at level 1 with the pending bonus applied in place of the stored one.
  const without = slot === null ? character : clearChoice(character, 1, slot.id);
  const totals = abilityTotals(without, data, 1);
  picked.forEach((ability, i) => {
    if (ability !== null) totals[ability] = Math.min(totals[ability] + (bonuses[i] ?? 0), 20);
  });

  const choose = (index: number, ability: Ability) => {
    if (slot === null) return;
    const next = [...picked];
    next[index] = ability;
    const [first, second] = next;
    if (first !== null && first !== undefined && second !== null && second !== undefined) {
      setHalf(null);
      onBonus(slot.id, [first, second]);
    } else {
      setHalf(next);
    }
  };
  const step = (ability: Ability, direction: 1 | -1) => {
    const value = character.abilities[ability];
    const target = direction === 1 ? Math.max(value + 1, POINT_BUY.min) : Math.min(value - 1, POINT_BUY.max);
    onBase(ability, target);
  };

  const mine = issues.filter((issue) => isScoreIssue(issue) || (slot !== null && issue.level === 1 && issue.slot === slot.id));
  return (
    <section className="frame abilities" aria-label={t("character.abilities")}>
      <div className="row">
        <h2>{t("character.abilities")}</h2>
        <span className={`pill ${spent === POINT_BUY.budget ? "good" : spent > POINT_BUY.budget ? "bad" : "todo"}`} aria-label={t("character.pointBuy")}>
          {t("character.points", { spent, budget: POINT_BUY.budget })}
        </span>
        {slot !== null && !complete && <span className="pill todo">{t("character.abilitiesToChoose")}</span>}
        {slot === null && <span className="feat">{t("character.abilitiesNeedClass")}</span>}
      </div>
      <div className="tblwrap">
        <table className="abiltable">
          <thead>
            <tr>
              <th scope="col">{t("character.abilityColumn")}</th>
              <th scope="col">{t("character.baseColumn")}</th>
              {bonuses.map((bonus, i) => (
                <th key={i} scope="col">{`+${bonus}`}</th>
              ))}
              <th scope="col">{t("character.totalColumn")}</th>
              <th scope="col">{t("character.modColumn")}</th>
            </tr>
          </thead>
          <tbody>
            {ABILITIES.map((ability) => {
              const name = gameName(data, lang, "ability", ability);
              const base = character.abilities[ability];
              return (
                <tr key={ability}>
                  <td>{name}</td>
                  <td>
                    <span className="step">
                      <button type="button" aria-label={t("character.lower", { ability: name })} disabled={base <= POINT_BUY.min} onClick={() => step(ability, -1)}>
                        −
                      </button>
                      <span>{base}</span>
                      <button type="button" aria-label={t("character.raise", { ability: name })} disabled={base >= POINT_BUY.max} onClick={() => step(ability, 1)}>
                        +
                      </button>
                    </span>
                  </td>
                  {bonuses.map((bonus, i) => (
                    <td key={i}>
                      <input
                        type="radio"
                        name={`${group}-${i}`}
                        aria-label={`+${bonus} ${name}`}
                        checked={picked[i] === ability}
                        // The ability that holds the other bonus cannot take this one.
                        disabled={slot === null || picked[1 - i] === ability}
                        onChange={() => choose(i, ability)}
                      />
                    </td>
                  ))}
                  <td className="tot">{totals[ability]}</td>
                  <td>{modifier(totals[ability])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <IssueList data={data} issues={mine} />
    </section>
  );
}
