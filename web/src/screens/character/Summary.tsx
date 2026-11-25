import { useMemo } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import { abilityTotals } from "../../../../src/engine/abilities.ts";
import { contribution } from "../../../../src/engine/contribution.ts";
import { activeParty, coverage, skillProficiencies, truncate } from "../../../../src/engine/coverage.ts";
import { validate } from "../../../../src/engine/validate.ts";
import { MAX_LEVELS } from "../../../../src/plan/model.ts";
import type { Character, Run } from "../../../../src/plan/model.ts";
import type { Lang } from "../../i18n/i18n.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { characterLabel, gameName } from "../../names.ts";
import { AbilityTiles, BringsPills, ClassLine, classLineText } from "../party/MemberCard.tsx";

type Props = { character: Character; run: Run; data: GameData; lang: Lang };

/**
 * What the character is and brings at the level the run has reached: its classes and level-12 plan, its six abilities
 * (base and what its level choices add), what it brings to the current act's active group, its skills, and the choices
 * still to make in its whole plan.
 */
export default function Summary({ character, run, data, lang }: Props) {
  const { t } = useI18n();
  const { level, act } = run.progress;
  const cut = truncate(character, level);
  const totals = abilityTotals(cut, data, cut.levels.length);
  // The engine passes over the whole party: computed again only when the run, the character or the data change.
  const { members, brings, skillValues, undecided } = useMemo(() => {
    const members = activeParty(run);
    const inGroup = members.some((member) => member.id === character.id);
    const brings = inGroup ? (contribution(run, data, level).get(character.id) ?? { only: [], best: [], highest: [] }) : null;
    const skillValues: Record<string, number> = inGroup ? Object.fromEntries(coverage(run, data, level).flatMap((row) => (row.best === null ? [] : [[row.skill, row.best.value]]))) : {};
    const undecided = validate({ ...run, characters: [character] }, data).issues.filter((issue) => issue.code === "choiceMissing").length;
    return { members, brings, skillValues, undecided };
  }, [run, character, data, level]);
  const { proficient, expertise } = skillProficiencies(cut, data);
  const skills = [...proficient].map((id) => ({ id, name: gameName(data, lang, "skill", id), expert: expertise.has(id) })).sort((a, b) => a.name.localeCompare(b.name, lang));
  const skillsId = `summary-skills-${character.id}`;

  return (
    <section className="frame summary" aria-label={t("character.summary")}>
      <h1>{characterLabel(data, lang, character.who, t("party.player"))}</h1>
      <p className="cls">
        <ClassLine character={character} level={level} data={data} lang={lang} none={t("party.noClass")} /> <span className="sub">{t("character.summary.atLevel", { level })}</span>
      </p>
      <p className="sub">{t("party.plan", { level: MAX_LEVELS, classes: classLineText(character, MAX_LEVELS, data, lang) || t("party.noClass") })}</p>
      <h4>{t("character.summary.abilities", { level })}</h4>
      <AbilityTiles totals={totals} highest={brings?.highest ?? []} data={data} lang={lang} base={character.abilities} />
      <div className="brings">
        <h4>{t("character.summary.brings", { act })}</h4>
        <div className="pills">
          {brings === null ? (
            <span className="sub">{t("character.summary.atCamp", { act })}</span>
          ) : (
            <BringsPills contribution={brings} alone={members.length === 1} skillValues={skillValues} level={level} data={data} lang={lang} />
          )}
        </div>
      </div>
      <h4 id={skillsId}>{t("character.summary.skills")}</h4>
      <div className="pills" role="group" aria-labelledby={skillsId}>
        {skills.length === 0 ? (
          <span className="sub">{t("character.summary.noSkills")}</span>
        ) : (
          skills.map(({ id, name, expert }) => (
            <span key={id} className={`pill${expert ? " acc" : ""}`}>
              {expert ? t("character.summary.expertise", { skill: name }) : name}
            </span>
          ))
        )}
      </div>
      <h4>{t("character.summary.toSettle")}</h4>
      <div className="pills">
        <span className={`pill ${undecided === 0 ? "good" : "todo"}`}>
          {undecided === 0 ? t("character.summary.nothing") : t(undecided === 1 ? "character.summary.choices.one" : "character.summary.choices", { count: undecided })}
        </span>
      </div>
    </section>
  );
}
