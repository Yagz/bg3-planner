import { useId, useMemo } from "react";
import { isEquipmentIssue } from "./EquipmentTab.tsx";
import type { GameData } from "../../../../src/data/types.ts";
import { abilityTotals } from "../../../../src/engine/abilities.ts";
import { spellSources } from "../../../../src/engine/casting.ts";
import { contribution } from "../../../../src/engine/contribution.ts";
import { activeParty, characterSkillValues, coverage, proficiencyBonus, truncate } from "../../../../src/engine/coverage.ts";
import { rulesetEffects } from "../../../../src/engine/difficulty.ts";
import { validate } from "../../../../src/engine/validate.ts";
import type { Character, Run } from "../../../../src/plan/model.ts";
import { isOffData } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";
import { signed } from "../Coverage.tsx";
import { AbilityTiles, BringsPills, ClassLine } from "../party/MemberCard.tsx";

type Props = {
  character: Character;
  run: Run;
  data: GameData;
  /** The level the character is seen at, 1 to its number of levels (a larger value reads as its last level). */
  viewed: number;
  onViewed: (level: number) => void;
};

/**
 * The character's side column: the classes at the viewed level as its title, identity, abilities, proficiency bonus, spell save DCs and all 18 skills at the
 * viewed level, what it brings to the current act's active group, and what is left to settle in its whole plan.
 */
export default function Sidebar({ character, run, data, viewed, onViewed }: Props) {
  const { t, lang } = useI18n();
  const id = useId();
  const levels = character.levels.length;
  const at = Math.max(1, Math.min(viewed, levels));
  const { act } = run.progress;
  const added = rulesetEffects(run.difficulty, data).proficiencyBonus;
  const cut = truncate(character, at);
  const totals = abilityTotals(cut, data, at);
  const bonus = proficiencyBonus(at) + added;
  // The engine passes over the whole party: computed again only when the run, the character or the data change.
  const { members, brings, skillValues, issues } = useMemo(() => {
    const members = activeParty(run);
    const inGroup = members.some((member) => member.id === character.id);
    const brings = inGroup ? (contribution(run, data, run.progress.level).get(character.id) ?? { only: [], best: [], highest: [] }) : null;
    const skillValues: Record<string, number> = inGroup ? Object.fromEntries(coverage(run, data, run.progress.level).flatMap((row) => (row.best === null ? [] : [[row.skill, row.best.value]]))) : {};
    return { members, brings, skillValues, issues: validate({ ...run, characters: [character] }, data).issues };
  }, [run, character, data]);
  const skills = characterSkillValues(character, data, at, added)
    .map((entry) => ({ ...entry, name: gameName(data, lang, "skill", entry.skill) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  const sources = spellSources(character, data, at);
  const identity = [character.subrace === null || character.subrace === "" ? character.race : character.subrace, character.background]
    .map((value, i) => (value === null || value === "" ? "" : isOffData(value) ? value.offData : gameName(data, lang, i === 0 ? "race" : "background", value)))
    .filter((part) => part !== "")
    .join(" · ");

  const count = (key: string, n: number) => t(n === 1 ? `${key}.one` : key, { count: n });
  const settle = new Map<number | null, { todo: number; invalid: number }>();
  const equipment = new Map<number | null, { todo: number; invalid: number }>();
  for (const issue of issues) {
    if (issue.severity !== "incomplete" && issue.severity !== "invalid") continue;
    // Equipment issues are settled on the Equipment tab: counted apart, not as character creation.
    const target = isEquipmentIssue(issue) ? equipment : settle;
    const key = isEquipmentIssue(issue) ? 0 : issue.level;
    const entry = target.get(key) ?? { todo: 0, invalid: 0 };
    entry[issue.severity === "invalid" ? "invalid" : "todo"]++;
    target.set(key, entry);
  }
  const partsOf = ({ todo, invalid }: { todo: number; invalid: number }) => [...(todo > 0 ? [count("character.summary.todo", todo)] : []), ...(invalid > 0 ? [count("character.summary.invalid", invalid)] : [])].join(" · ");
  const lines = [
    ...[...settle]
      .sort(([a], [b]) => (a ?? 0) - (b ?? 0))
      .map(([level, entry]) => {
        const parts = partsOf(entry);
        return { key: String(level ?? "creation"), text: level === null ? t("character.summary.settleCreation", { parts }) : t("character.summary.settleLevel", { level, parts }) };
      }),
    ...[...equipment.values()].map((entry) => ({ key: "equipment", text: t("character.summary.settleEquipment", { parts: partsOf(entry) }) })),
  ];

  return (
    <section className="frame sidebar">
      <h2 className="sidetitle">
        <ClassLine character={character} level={at} data={data} lang={lang} none={t("party.noClass")} />
      </h2>
      <p className="subline">{identity}</p>
      <label className="viewed">
        {t("character.summary.viewed")}
        <select value={at} onChange={(event) => onViewed(Number(event.target.value))}>
          {Array.from({ length: levels }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === run.progress.level ? t("character.summary.inGame", { level: n }) : n}
            </option>
          ))}
        </select>
      </label>
      {/* The group's highest abilities hold at the level the contribution was computed for (the run's, within the plan) only. */}
      <AbilityTiles totals={totals} highest={at === Math.min(run.progress.level, levels) ? (brings?.highest ?? []) : []} data={data} lang={lang} base={character.abilities} />
      <dl className="sidekv">
        <dt>{t("character.summary.proficiency")}</dt>
        <dd>{signed(bonus)}</dd>
        {sources.map((source) => (
          <div key={`${source.kind}:${source.id}:${source.ability}`} className="sidekvrow">
            <dt>{t("character.summary.dc", { source: gameName(data, lang, source.kind, source.id), ability: gameName(data, lang, "ability", source.ability) })}</dt>
            <dd>{t("character.summary.dcValue", { value: 8 + bonus + Math.floor((totals[source.ability] - 10) / 2) })}</dd>
          </div>
        ))}
      </dl>
      <h4 id={`${id}-skills`}>{t("character.summary.skills")}</h4>
      <ul className="sideskills" aria-labelledby={`${id}-skills`}>
        {skills.map(({ skill, name, value, proficient, expertise }) => {
          const description = gameDescription(data, lang, "skill", skill);
          const tip = `${id}-tip-${skill}`;
          return (
            <li key={skill} className="skl">
              <span className="nm" tabIndex={0} aria-describedby={description === null ? undefined : tip}>
                {name}
              </span>
              <b className={expertise ? "exp" : proficient ? "prof" : undefined}>{signed(value)}</b>
              <span className="mark">
                {expertise ? <span aria-hidden="true">◆</span> : null}
                {proficient && <span className="sr">{expertise ? t("character.summary.expert") : t("character.summary.proficient")}</span>}
              </span>
              {description !== null && (
                <span className="tip" id={tip} role="tooltip">
                  {description}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="legend">{t("character.summary.legend")}</p>
      <div className="brings">
        <h4>{t("character.summary.brings", { act })}</h4>
        <div className="pills">
          {brings === null ? (
            <span className="sub">{t("character.summary.atCamp", { act })}</span>
          ) : (
            <BringsPills contribution={brings} alone={members.length === 1} skillValues={skillValues} level={run.progress.level} data={data} lang={lang} />
          )}
        </div>
      </div>
      <h4>{t("character.summary.toSettle")}</h4>
      {lines.length === 0 ? (
        <p className="pill good">{t("character.summary.nothing")}</p>
      ) : (
        <ul className="settle">
          {lines.map(({ key, text }) => (
            <li key={key}>{text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
