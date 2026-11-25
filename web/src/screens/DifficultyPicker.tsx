import { useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { rulesetEffects } from "../../../src/engine/difficulty.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { gameDescription, gameName } from "../names.ts";

/** The ruleset the game presents as its Custom Mode: it is offered last, under the custom-mode label. */
const CUSTOM = "RULESET_LARIAN";

type Props = {
  data: GameData;
  run: Run;
  /** Saves a new version of the run; throws when the store refuses. */
  saveRun: (run: Run) => void;
};

/** The run's difficulty: the game's rulesets, the build modifiers of Custom Mode, and what the choice changes for a build. */
export default function DifficultyPicker({ data, run, saveRun }: Props) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<string | null>(null);
  const { rulesets, rulesetModifiers } = data.rules;
  const { ruleset, overrides } = run.difficulty;
  const effects = rulesetEffects(run.difficulty, data);

  const ids = Object.keys(rulesets).sort((a, b) => (a === CUSTOM ? 1 : b === CUSTOM ? -1 : rulesets[a]!.order - rulesets[b]!.order));
  const offered = ruleset === "" || ids.includes(ruleset) ? ids : [...ids, ruleset];
  const nameOfRuleset = (id: string) => (id === CUSTOM ? gameName(data, lang, "label", "customMode") : gameName(data, lang, "ruleset", id));

  const save = (difficulty: Run["difficulty"]) => {
    try {
      saveRun({ ...run, difficulty });
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  /** Sets one custom modifier; a value equal to what the ruleset gives without it is no override. */
  const setOverride = (modifier: "MULTICLASSING" | "PROFICIENCY_BONUS", value: boolean | number) => {
    const base = rulesets[ruleset]?.values[modifier] ?? rulesetModifiers[modifier].default;
    const next = { ...overrides };
    if (value === base) delete next[modifier];
    else next[modifier] = value;
    save({ ruleset, overrides: next });
  };

  const bonus = effects.proficiencyBonus;
  const bonusRange = rulesetModifiers.PROFICIENCY_BONUS;
  const custom = ruleset === CUSTOM;

  return (
    <div className="difficulty">
      <select
        aria-label={t("difficulty.label")}
        value={ruleset}
        title={ruleset === CUSTOM ? undefined : (gameDescription(data, lang, "ruleset", ruleset) ?? undefined)}
        onChange={(event) => save({ ruleset: event.target.value, overrides: {} })}
      >
        {ruleset === "" && <option value="">{t("difficulty.choose")}</option>}
        {offered.map((id) => (
          <option key={id} value={id} title={id === CUSTOM ? undefined : (gameDescription(data, lang, "ruleset", id) ?? undefined)}>
            {nameOfRuleset(id)}
          </option>
        ))}
      </select>
      {custom && rulesetModifiers.MULTICLASSING.custom && (
        <label className="check" title={gameDescription(data, lang, "modifier", "MULTICLASSING") ?? undefined}>
          <input type="checkbox" checked={effects.multiclass} onChange={(event) => setOverride("MULTICLASSING", event.target.checked)} />
          {gameName(data, lang, "modifier", "MULTICLASSING")}
        </label>
      )}
      {custom && bonusRange.custom && (
        <label className="check" title={gameDescription(data, lang, "modifier", "PROFICIENCY_BONUS") ?? undefined}>
          {gameName(data, lang, "modifier", "PROFICIENCY_BONUS")}
          <input
            type="number"
            min={bonusRange.min}
            max={bonusRange.max}
            step={1}
            value={bonus}
            onChange={(event) => {
              const value = event.target.valueAsNumber;
              if (Number.isInteger(value) && (bonusRange.min === undefined || value >= bonusRange.min) && (bonusRange.max === undefined || value <= bonusRange.max)) {
                setOverride("PROFICIENCY_BONUS", value);
              }
            }}
          />
        </label>
      )}
      <span className="pills">
        {!effects.known && <span className="pill bad">{t("difficulty.unknown", { id: ruleset })}</span>}
        {!effects.multiclass && <span className="pill muted">{t("difficulty.noMulticlass")}</span>}
        {bonus !== 0 && <span className="pill muted">{t(bonus > 0 ? "difficulty.bonusUp" : "difficulty.bonusDown", { n: bonus })}</span>}
        {effects.honourStats && <span className="pill muted">{t("difficulty.honourStats")}</span>}
      </span>
      {error !== null && (
        <span className="pill bad" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
