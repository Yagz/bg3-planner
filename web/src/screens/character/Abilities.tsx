import { useEffect, useId, useRef, useState } from "react";
import type { FocusEvent } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import { ABILITY_CAP, POINT_BUY, abilityTotals, pointsSpent } from "../../../../src/engine/abilities.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { ABILITIES } from "../../../../src/plan/model.ts";
import type { Ability, Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import { clearChoice, setAbilities } from "../../state/characterOps.ts";
import { signed } from "../Coverage.tsx";
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

/** The signed modifier of a score, with the same minus sign as the sidebar. */
const modifier = (score: number): string => signed(Math.floor((score - 10) / 2));

const sameScores = (a: Record<Ability, number>, b: Record<Ability, number>) => ABILITIES.every((ability) => a[ability] === b[ability]);

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues (all of them): the frame keeps those about the scores and about its bonus slot. */
  issues: Issue[];
  /**
   * Saves one edit session in one change: the base scores, and the level-1 bonus slot with the abilities `[+2, +1]` when
   * both are chosen and differ from the stored ones (null otherwise). Returns false (or throws) when the save was refused:
   * the edits then stay pending and are offered again. `direct` is set when the frame unmounts or the page is hidden:
   * the change must then be saved without the impact preview, which could no longer be answered.
   */
  onCommit: (base: Record<Ability, number>, bonus: { slot: string; choice: string[] } | null, options: { direct: boolean }) => boolean | void;
};

/** Edits not saved yet, each kept only while what it was made against is still what is stored. */
type Draft = {
  /** Base scores, against the stored scores. */
  base: { key: string; scores: Record<Ability, number> } | null;
  /** The bonus pair (possibly half made), against the bonus slot and its stored choice. */
  bonus: { key: string; pair: (Ability | null)[] } | null;
};

/**
 * The abilities table: base score (point buy), the level-1 +2 and +1 as radio columns, the total at level 1 and the
 * modifier. The − / + buttons and the radios change the frame's own state only, shown at once; the edits are saved
 * together, as one version, when focus leaves the table, when the frame unmounts and when the page is hidden (closing a
 * browser tab fires no blur). A half-made bonus is never saved.
 */
export default function Abilities({ data, character, issues, onCommit }: Props) {
  const { t, lang } = useI18n();
  const group = useId();
  const slot = levelOneBonusSlot(character, data);
  const stored = slot === null ? undefined : character.levels[0]?.choices[slot.id];
  const storedPair: (Ability | null)[] = Array.isArray(stored) && stored.length === 2 && stored.every(isAbility) ? stored : [null, null];
  const [draft, setDraft] = useState<Draft>({ base: null, bonus: null });
  // Each edit is dropped as soon as what it was made against is no longer stored (history restore, import, a save, a new
  // level-1 class).
  const baseKey = JSON.stringify(character.abilities);
  const bonusKey = JSON.stringify([slot?.id ?? null, stored ?? null]);
  const scores = draft.base !== null && draft.base.key === baseKey ? draft.base.scores : character.abilities;
  const half = draft.bonus !== null && slot !== null && draft.bonus.key === bonusKey ? draft.bonus.pair : null;
  const picked = half ?? storedPair;
  const complete = picked[0] !== null && picked[1] !== null;
  const bonuses = slot?.bonuses ?? [2, 1];
  const spent = pointsSpent(scores);

  // The total at level 1 with the pending scores and bonus applied in place of the stored ones.
  const without = setAbilities(slot === null ? character : clearChoice(character, 1, slot.id), scores);
  const totals = abilityTotals(without, data, 1);
  picked.forEach((ability, i) => {
    if (ability !== null) totals[ability] = Math.min(totals[ability] + (bonuses[i] ?? 0), ABILITY_CAP);
  });

  // What a save would send, read by the handlers that outlive this render (unmount, pagehide).
  const scoresChanged = !sameScores(scores, character.abilities);
  const pairChanged = slot !== null && complete && (picked[0] !== storedPair[0] || picked[1] !== storedPair[1]);
  const latest = useRef({ scores, bonus: null as { slot: string; choice: string[] } | null, dirty: false, onCommit });
  latest.current = { scores, bonus: pairChanged ? { slot: slot.id, choice: picked as Ability[] } : null, dirty: scoresChanged || pairChanged, onCommit };

  /** `direct` on unmount and pagehide: saved without the impact preview (the engine still flags a later choice made invalid). */
  const flush = (direct: boolean) => {
    const { scores: base, bonus, dirty, onCommit: save } = latest.current;
    if (!dirty) return;
    // Cleared only once the save went through (or opened the impact preview): a refused one is offered again.
    if (save(base, bonus, { direct }) === false) return;
    latest.current.dirty = false;
    // A half-made bonus stays: it was not part of the save.
    setDraft((current) => ({ base: null, bonus: bonus === null ? current.bonus : null }));
  };

  useEffect(() => {
    const hidden = () => flush(true);
    window.addEventListener("pagehide", hidden);
    return () => {
      window.removeEventListener("pagehide", hidden);
      flush(true);
    };
  }, []);

  const leave = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    flush(false);
  };

  const choose = (index: number, ability: Ability) => {
    if (slot === null) return;
    const next = [...picked];
    next[index] = ability;
    setDraft((current) => ({ ...current, bonus: { key: bonusKey, pair: next } }));
  };
  const step = (ability: Ability, direction: 1 | -1) => {
    const value = scores[ability];
    const target = direction === 1 ? Math.max(value + 1, POINT_BUY.min) : Math.min(value - 1, POINT_BUY.max);
    setDraft((current) => ({ ...current, base: { key: baseKey, scores: { ...scores, [ability]: target } } }));
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
      <div className="tblwrap" onBlur={leave}>
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
              const base = scores[ability];
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
