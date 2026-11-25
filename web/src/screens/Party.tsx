import { useMemo, useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { coverage, truncate } from "../../../src/engine/coverage.ts";
import { resolve, subclassSlot } from "../../../src/engine/progression.ts";
import { levelSlots, requiredSelectors, validate } from "../../../src/engine/validate.ts";
import { MAX_LEVELS, isOffData } from "../../../src/plan/model.ts";
import type { Character, Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import type { Translate } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import { ACTS, setProgress } from "../state/partyOps.ts";
import type { Act } from "../state/partyOps.ts";
import Coverage, { signed } from "./Coverage.tsx";
import PartyEditor from "./PartyEditor.tsx";

type Props = {
  data: GameData;
  /** The current run, owned by the app shell. */
  run: Run;
  /** Saves a new version of the run; throws when the store refuses. */
  saveRun: (run: Run) => void;
  onOpenCharacter: (id: string) => void;
};

const plural = (t: Translate, key: string, count: number) => t(count === 1 ? `${key}.one` : key, { count });

/** What a level asks, as `[kind, count]` pairs in display order: subclass, feat, then the required picks by kind. */
function choicesAsked(character: Character, level: number, data: GameData): [string, number][] {
  const resolved = resolve(character, data).levels[level - 1];
  if (resolved === undefined) return [];
  const slots = levelSlots(resolved, character.levels[level - 1]?.choices ?? {}, data);
  const kinds = new Map<string, number>();
  if (slots.subclass !== null) kinds.set("subclass", 1);
  if (slots.feat !== null) kinds.set("feat", 1);
  for (const { selector } of requiredSelectors(slots)) kinds.set(selector.function, (kinds.get(selector.function) ?? 0) + 1);
  return [...kinds];
}

/** "Ranger 3 / Rogue 1" with the subclass chosen so far, from the first `level` levels. */
function classesAt(character: Character, level: number, data: GameData, lang: "fr" | "en") {
  const counts = new Map<string, number>();
  for (const entry of truncate(character, level).levels) {
    if (isOffData(entry.class) || entry.class === "") continue;
    counts.set(entry.class, (counts.get(entry.class) ?? 0) + 1);
  }
  return [...counts].map(([cls, count]) => {
    const chosen = truncate(character, level)
      .levels.map((entry) => entry.choices[subclassSlot(cls)])
      .find((choice) => Array.isArray(choice));
    const subclass = Array.isArray(chosen) ? chosen[0] : undefined;
    return { cls, text: `${gameName(data, lang, "class", cls)} ${count}`, subclass: subclass === undefined ? null : gameName(data, lang, "class", subclass) };
  });
}

/** The in-game reference: what each active member takes next, what is still undecided, and the party's skill coverage. */
export default function Party({ data, run, saveRun, onOpenCharacter }: Props) {
  const { t, lang } = useI18n();
  const [error, setError] = useState<string | null>(null);

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
  const act = run.progress.act;
  const issues = useMemo(() => validate(run, data).issues, [run, data]);
  const skills = useMemo(() => coverage(run, data, level), [run, data, level]);

  const label = (character: Character) => characterLabel(data, lang, character.who, t("party.player"));
  const active = run.party[String(act) as "1" | "2" | "3"].active.flatMap((id) => run.characters.filter((c) => c.id === id).slice(0, 1));
  const others = run.characters.filter((c) => !active.includes(c));
  const status = run.party[String(act) as "1" | "2" | "3"].status;
  const skillName = (skill: string) => gameName(data, lang, "skill", skill);
  const who = (id: string) => {
    const character = run.characters.find((c) => c.id === id);
    return character === undefined ? id : label(character);
  };

  const uncovered = skills.filter((s) => s.proficient.length === 0).map((s) => skillName(s.skill));
  const best = skills
    .filter((s) => s.best !== null)
    .sort((a, b) => (b.best?.value ?? 0) - (a.best?.value ?? 0))
    .slice(0, 3)
    .map((s) => `${skillName(s.skill)} ${signed(s.best?.value ?? 0)} (${who(s.best?.character ?? "")})`);

  const next = (character: Character) => {
    const n = level + 1;
    if (level >= MAX_LEVELS) return <p>{t("party.next.top")}</p>;
    const entry = character.levels[n - 1];
    if (entry === undefined) return <p className="sub">{t("party.next.none", { level: n })}</p>;
    if (isOffData(entry.class) || entry.class === "") return <p className="sub">{t("party.next.noClass", { level: n })}</p>;
    const asked = choicesAsked(character, n, data);
    const askedText = asked.map(([kind, count]) => (count > 1 ? `${t(`choice.${kind}`)} (${count})` : t(`choice.${kind}`))).join(", ");
    const undecided = issues.filter((i) => i.character === character.id && i.code === "choiceMissing" && i.level !== null && i.level <= n).length;
    return (
      <>
        <p>
          <strong>{t("party.next", { level: n, class: gameName(data, lang, "class", entry.class) })}</strong>{" "}
          <span className={`pill ${asked.length === 0 ? "muted" : "acc"}`}>{asked.length === 0 ? t("party.next.nothing") : askedText}</span>
        </p>
        <p>
          <span className={`pill ${undecided === 0 ? "good" : "todo"}`}>{undecided === 0 ? t("party.decided") : plural(t, "party.undecided", undecided)}</span>
        </p>
      </>
    );
  };

  return (
    <div className="party">
      <h1>{t("party.title")}</h1>
      {error !== null && (
        <p className="banner" role="alert">
          {t("party.error", { message: error })}
        </p>
      )}
      <div className="row progress" role="group" aria-label={t("party.progress")}>
        <label>
          {t("party.progress.level")}{" "}
          <select value={level} onChange={(event) => apply((current) => setProgress(current, Number(event.target.value), act))}>
            {Array.from({ length: MAX_LEVELS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("party.progress.act")}{" "}
          <select value={act} onChange={(event) => apply((current) => setProgress(current, level, Number(event.target.value) as Act))}>
            {ACTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {active.length === 0 ? (
        <p className="sub">{t("party.empty", { act })}</p>
      ) : (
        <div className="cards">
          {active.map((character) => (
            <article key={character.id} className="card">
              <h2>{label(character)}</h2>
              <p>
                {classesAt(character, level, data, lang).map((entry, i) => (
                  <span key={entry.cls}>
                    {i > 0 && " / "}
                    {entry.text}
                    {entry.subclass !== null && <span className="sub"> ({entry.subclass})</span>}
                  </span>
                ))}
                {classesAt(character, level, data, lang).length === 0 && <span className="sub">{t("party.noClass")}</span>}
              </p>
              {next(character)}
              <button className="btn" onClick={() => onOpenCharacter(character.id)}>
                {t("party.openBuild")}
              </button>
            </article>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <section className="others" aria-label={t("party.others")}>
          <h2>{t("party.others")}</h2>
          <ul>
            {others.map((character) => (
              <li key={character.id}>
                <button className="chip" onClick={() => onOpenCharacter(character.id)}>
                  {label(character)}
                </button>{" "}
                <span className="pill muted">{status[character.id] === undefined ? t("party.noStatus") : t(`status.${status[character.id]}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section className="summary" aria-label={t("party.coverage")}>
          <h2>{t("party.coverage")}</h2>
          <p>{uncovered.length > 0 ? t("party.coverage.uncovered", { skills: uncovered.join(", ") }) : t("party.coverage.all")}</p>
          <p>{t("party.coverage.best", { skills: best.join(", ") })}</p>
          <details>
            <summary>{t("party.coverage.table")}</summary>
            <Coverage run={run} data={data} />
          </details>
        </section>
      )}

      <PartyEditor run={run} data={data} apply={apply} />
    </div>
  );
}
