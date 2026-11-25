import { useMemo } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { coverage } from "../../../src/engine/coverage.ts";
import type { SkillCoverage } from "../../../src/engine/coverage.ts";
import { MAX_LEVELS } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";

export const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

/** Per skill, the best value of the active party at the level reached and at level 12, with who has it and how. */
export default function Coverage({ run, data }: { run: Run; data: GameData }) {
  const { t, lang } = useI18n();
  const level = run.progress.level;
  const rows = useMemo(() => {
    const now = coverage(run, data, level);
    const top = coverage(run, data, MAX_LEVELS);
    return now.map((row, i) => ({ skill: row.skill, ability: row.ability, now: row, top: top[i] as SkillCoverage }));
  }, [run, data, level]);

  const label = (id: string) => {
    const who = run.characters.find((character) => character.id === id)?.who ?? id;
    return characterLabel(data, lang, who, t("party.player"));
  };
  const cell = (row: SkillCoverage) =>
    row.best === null ? (
      <span className="sub">{t("party.coverage.noMember")}</span>
    ) : (
      <>
        <strong className="counter">{signed(row.best.value)}</strong> {label(row.best.character)}{" "}
        {row.best.expertise ? <span className="pill good">{t("party.coverage.expertise")}</span> : row.best.proficient ? <span className="pill acc">{t("party.coverage.prof")}</span> : null}
      </>
    );

  return (
    <table className="coverage">
      <thead>
        <tr>
          <th scope="col">{t("party.coverage.skill")}</th>
          <th scope="col">{t("party.coverage.atLevel", { level })}</th>
          <th scope="col">{t("party.coverage.atLevel", { level: MAX_LEVELS })}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.skill}>
            <th scope="row">
              {gameName(data, lang, "skill", row.skill)} <span className="sub">({gameName(data, lang, "ability", row.ability)})</span>
            </th>
            <td>{cell(row.now)}</td>
            <td>{cell(row.top)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
