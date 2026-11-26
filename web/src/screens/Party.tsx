import { useEffect, useMemo, useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { contribution } from "../../../src/engine/contribution.ts";
import { activeParty, coverage, proficiencyBonus, truncate } from "../../../src/engine/coverage.ts";
import { rulesetEffects } from "../../../src/engine/difficulty.ts";
import { validate } from "../../../src/engine/validate.ts";
import { MAX_LEVELS, isOffData } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { gameName } from "../names.ts";
import { ACTS, PARTY_SIZE, copyPartyFromPreviousAct, setPartySize, setProgress } from "../state/partyOps.ts";
import type { Act } from "../state/partyOps.ts";
import Coverage from "./Coverage.tsx";
import DifficultyPicker from "./DifficultyPicker.tsx";
import PartyEditor from "./PartyEditor.tsx";
import MemberCard from "./party/MemberCard.tsx";

type Props = {
  data: GameData;
  /** The current run, owned by the app shell. */
  run: Run;
  /** Saves a new version of the run; throws when the store refuses. */
  saveRun: (run: Run) => void;
  onOpenCharacter: (id: string) => void;
};

/** The in-game reference: the party composer, the active group as cards of what each member brings, and the group as a whole. */
export default function Party({ data, run, saveRun, onOpenCharacter }: Props) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<string | null>(null);
  // The act shown is view state, never saved; it follows the current act when that changes.
  const [act, setAct] = useState<Act>(run.progress.act);
  useEffect(() => setAct(run.progress.act), [run.progress.act]);

  /** Applies an operation to the run and saves the result; anything that throws (the operation or the save) shows the error banner. */
  const apply = (operation: (run: Run) => Run) => {
    try {
      saveRun(operation(run));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const level = run.progress.level;
  const view = useMemo(() => ({ ...run, progress: { ...run.progress, act } }), [run, act]);
  const members = useMemo(() => activeParty(view), [view]);
  const skills = useMemo(() => coverage(view, data, level), [view, data, level]);
  const brings = useMemo(() => contribution(view, data, level), [view, data, level]);
  const issues = useMemo(() => validate(run, data).issues, [run, data]);
  const effects = rulesetEffects(run.difficulty, data);
  const bonus = proficiencyBonus(level) + effects.proficiencyBonus;

  const undecided = (id: string) => issues.filter((issue) => issue.character === id && issue.code === "choiceMissing").length;
  const skillValues = Object.fromEntries(skills.flatMap((row) => (row.best === null ? [] : [[row.skill, row.best.value]])));
  const holes = skills.filter((row) => row.proficient.length === 0).map((row) => gameName(data, lang, "skill", row.skill));
  const classes = [
    ...new Set(members.flatMap((character) => truncate(character, level).levels.flatMap((entry) => (isOffData(entry.class) || entry.class === "" ? [] : [entry.class])))),
  ].map((cls) => gameName(data, lang, "class", cls));
  const toDecide = members.reduce((sum, character) => sum + undecided(character.id), 0);

  return (
    <div className="party">
      <h1>{t("party.title")}</h1>
      {error !== null && (
        <p className="banner" role="alert">
          {t("party.error", { message: error })}
        </p>
      )}
      <div className="stack">
        <section className="frame runframe" aria-labelledby="run-title">
          <div className="head">
            <h2 id="run-title">{run.name === "" ? t("run.untitled") : run.name}</h2>
            <span className="note">{t("party.run.effect", { bonus, multiclass: t(effects.multiclass ? "party.run.multiclassOn" : "party.run.multiclassOff") })}</span>
          </div>
          <div className="settings" role="group" aria-label={t("party.progress")}>
            <div className="field">
              <span aria-hidden="true">{t("difficulty.label")}</span>
              <DifficultyPicker data={data} run={run} saveRun={saveRun} />
            </div>
            <label className="field">
              <span>{t("party.progress.level")}</span>
              <select value={level} onChange={(event) => apply((current) => setProgress(current, Number(event.target.value), current.progress.act))}>
                {Array.from({ length: MAX_LEVELS }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("party.progress.act")}</span>
              <select value={run.progress.act} onChange={(event) => apply((current) => setProgress(current, level, Number(event.target.value) as Act))}>
                {ACTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t("party.editor.size")}</span>
              <input
                type="number"
                min={PARTY_SIZE.min}
                max={PARTY_SIZE.max}
                step={1}
                value={run.partySize}
                onChange={(event) => {
                  if (event.target.value !== "") apply((current) => setPartySize(current, Number(event.target.value)));
                }}
              />
            </label>
          </div>
        </section>

        <PartyEditor run={run} data={data} apply={apply} act={act} setAct={setAct} />

        <section className="frame" aria-labelledby="group-title">
          <h2 id="group-title">{t("party.group")}</h2>
          <p className="note">{t("party.group.line", { act, level, bonus, count: members.length, size: run.partySize })}</p>
          {members.length === 0 ? (
            <p className="empty">
              {t("party.empty", { act })}{" "}
              {act > 1 && (
                <button className="btn small" onClick={() => apply((current) => copyPartyFromPreviousAct(current, act))}>
                  {t("party.group.copy")}
                </button>
              )}
            </p>
          ) : (
            <div className="cards">
              {members.map((character) => (
                <MemberCard
                  key={character.id}
                  character={character}
                  contribution={brings.get(character.id) ?? { only: [], best: [], highest: [] }}
                  level={level}
                  data={data}
                  lang={lang}
                  alone={members.length === 1}
                  skillValues={skillValues}
                  undecided={undecided(character.id)}
                  onOpen={() => onOpenCharacter(character.id)}
                />
              ))}
            </div>
          )}
          {members.length > 1 && <p className="note legend">{t("party.legend")}</p>}
        </section>

        <section className="frame" aria-labelledby="ensemble-title">
          <h2 id="ensemble-title">{t("party.ensemble")}</h2>
          <p className="summary-line">
            <span>{t("party.summary.covered", { count: skills.length - holes.length, total: skills.length })}</span>
            {holes.length > 0 ? <span className="gaps">{t("party.summary.gaps", { names: holes.join(", ") })}</span> : <span>{t("party.summary.noGaps")}</span>}
            <span className={toDecide > 0 ? "todo" : undefined}>{t("party.summary.choices", { count: toDecide })}</span>
            <span className="note">{t("party.summary.classes", { classes: classes.length > 0 ? classes.join(", ") : "—" })}</span>
          </p>
          <Coverage run={run} data={data} rows={skills} />
        </section>
      </div>
    </div>
  );
}
