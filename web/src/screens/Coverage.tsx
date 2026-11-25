import type { GameData } from "../../../src/data/types.ts";
import type { SkillCoverage } from "../../../src/engine/coverage.ts";
import { ABILITIES } from "../../../src/plan/model.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";

export const signed = (value: number): string => (value >= 0 ? `+${value}` : `−${Math.abs(value)}`);

/** The active group's skill coverage grouped under each ability: who is proficient and the group's best value, or nobody. */
export default function Coverage({ run, data, rows }: { run: Run; data: GameData; rows: SkillCoverage[] }) {
  const { t, lang } = useI18n();
  const label = (id: string) => {
    const who = run.characters.find((character) => character.id === id)?.who ?? id;
    return characterLabel(data, lang, who, t("party.player"));
  };

  return (
    <div className="cov">
      {ABILITIES.map((ability) => {
        const skills = rows.filter((row) => row.ability === ability);
        // An ability no skill uses (Constitution) has no group.
        if (skills.length === 0) return null;
        return (
          <div key={ability} className="grp">
            <h4>{gameName(data, lang, "ability", ability)}</h4>
            {skills.map((row) => (
              <div key={row.skill} className="row">
                <span>{gameName(data, lang, "skill", row.skill)}</span>
                {row.proficient.length > 0 ? (
                  <span className="pill good">
                    {row.proficient.map(label).join(", ")}
                    {row.best !== null && ` · ${signed(row.best.value)}`}
                  </span>
                ) : (
                  <span className="pill bad">{t("party.coverage.nobody")}</span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
