import type { GameData } from "../../../../src/data/types.ts";
import { abilityTotals } from "../../../../src/engine/abilities.ts";
import type { Contribution } from "../../../../src/engine/contribution.ts";
import { truncate } from "../../../../src/engine/coverage.ts";
import { subclassSlot } from "../../../../src/engine/progression.ts";
import { ABILITIES, MAX_LEVELS, isOffData } from "../../../../src/plan/model.ts";
import type { Ability, Character } from "../../../../src/plan/model.ts";
import type { Lang } from "../../i18n/i18n.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { characterLabel, gameName } from "../../names.ts";
import { signed } from "../Coverage.tsx";

/** The classes of a character's first `level` levels with their counts, and the subclass chosen so far for each. */
export function classesAt(character: Character, level: number, data: GameData, lang: Lang): { cls: string; text: string; subclass: string | null }[] {
  const cut = truncate(character, level);
  const counts = new Map<string, number>();
  for (const entry of cut.levels) {
    if (isOffData(entry.class) || entry.class === "") continue;
    counts.set(entry.class, (counts.get(entry.class) ?? 0) + 1);
  }
  return [...counts].map(([cls, count]) => {
    const chosen = cut.levels.map((entry) => entry.choices[subclassSlot(cls)]).find((choice) => Array.isArray(choice));
    const subclass = Array.isArray(chosen) ? chosen[0] : undefined;
    return { cls, text: `${gameName(data, lang, "class", cls)} ${count}`, subclass: subclass === undefined ? null : gameName(data, lang, "class", subclass) };
  });
}

/** "Ranger 3 (Gloom Stalker) · Rogue 1", or the no-class hint. */
export function ClassLine({ character, level, data, lang, none }: { character: Character; level: number; data: GameData; lang: Lang; none: string }) {
  const classes = classesAt(character, level, data, lang);
  if (classes.length === 0) return <span className="sub">{none}</span>;
  return (
    <>
      {classes.map((entry, i) => (
        <span key={entry.cls}>
          {i > 0 && " · "}
          {entry.text}
          {entry.subclass !== null && <span className="sub"> ({entry.subclass})</span>}
        </span>
      ))}
    </>
  );
}

/** The class line as plain text, subclasses in parentheses; empty when no class is chosen. */
export function classLineText(character: Character, level: number, data: GameData, lang: Lang): string {
  return classesAt(character, level, data, lang)
    .map((entry) => (entry.subclass === null ? entry.text : `${entry.text} (${entry.subclass})`))
    .join(" · ");
}

/** A game name, or nothing for an empty or outside-the-data identity field. */
function identityName(data: GameData, lang: Lang, kind: "race" | "background", value: string | { offData: string } | null): string | null {
  if (value === null || value === "" || isOffData(value)) return null;
  return gameName(data, lang, kind, value);
}

/** The ability's short label: the first three letters of the game's name, upper-cased. */
export const shortAbility = (data: GameData, lang: Lang, ability: string) => gameName(data, lang, "ability", ability).slice(0, 3).toLocaleUpperCase(lang);

/**
 * The six ability tiles: short label, total and modifier, the group's highest ones marked; with `base`, a last line
 * gives the base score and what the level choices add to it, only on an ability they raise.
 */
export function AbilityTiles({ totals, highest, data, lang, base }: { totals: Record<Ability, number>; highest: Ability[]; data: GameData; lang: Lang; base?: Record<Ability, number> }) {
  const { t } = useI18n();
  return (
    <div className="ab6">
      {ABILITIES.map((ability) => {
        const name = gameName(data, lang, "ability", ability);
        const bonus = base === undefined ? 0 : totals[ability] - base[ability];
        return (
          <div key={ability} className={`ab${highest.includes(ability) ? " hi" : ""}`} role="group" aria-label={name} title={name}>
            <span>{shortAbility(data, lang, ability)}</span>
            <b>{totals[ability]}</b>
            <small>{signed(Math.floor((totals[ability] - 10) / 2))}</small>
            {base !== undefined && bonus > 0 && <small className="gain">{t("character.summary.base", { base: base[ability], bonus })}</small>}
          </div>
        );
      })}
    </div>
  );
}

/** What a member brings as pills: skills only it has, skills where it is best, abilities where it is highest; "alone" or "nothing unique" otherwise. */
export function BringsPills({ contribution, alone, skillValues, level, data, lang }: { contribution: Contribution; alone: boolean; skillValues: Record<string, number>; level: number; data: GameData; lang: Lang }) {
  const { t } = useI18n();
  const skill = (id: string) => gameName(data, lang, "skill", id);
  const { only, best, highest } = contribution;
  if (alone) return <span className="sub">{t("party.brings.alone")}</span>;
  return (
    <>
      {/* A skill only this member has is a fact, not a valid state: neutral, as on the party cards. */}
      {only.map((id) => (
        <span key={id} className="pill muted">
          {t("party.brings.only", { skill: skill(id) })}
        </span>
      ))}
      {best.map((id) => (
        <span key={id} className="pill acc">
          {t("party.brings.best", { skill: skillValues[id] === undefined ? skill(id) : `${skill(id)} ${signed(skillValues[id])}` })}
        </span>
      ))}
      {highest.map((ability) => (
        <span key={ability} className="pill muted">
          {t("party.brings.highest", { ability: gameName(data, lang, "ability", ability) })}
        </span>
      ))}
      {only.length === 0 && best.length === 0 && highest.length === 0 && <span className="sub">{t("party.brings.nothing", { level })}</span>}
    </>
  );
}

/** What a member brings as plain text joined by middle dots: skills only it has, skills where it is best (brass, with a star), abilities where it is highest; "alone" or "nothing unique" otherwise. */
export function BringsText({ contribution, alone, skillValues, level, data, lang }: { contribution: Contribution; alone: boolean; skillValues: Record<string, number>; level: number; data: GameData; lang: Lang }) {
  const { t } = useI18n();
  const skill = (id: string) => gameName(data, lang, "skill", id);
  const { only, best, highest } = contribution;
  if (alone) return <p className="sub">{t("party.brings.alone")}</p>;
  const items = [
    ...only.map((id) => <span key={`only-${id}`}>{t("party.brings.only", { skill: skill(id) })}</span>),
    ...best.map((id) => (
      <span key={`best-${id}`} className="best">
        {skillValues[id] === undefined ? skill(id) : `${skill(id)} ${signed(skillValues[id])}`}{" "}
        <span role="img" aria-label={t("party.brings.bestMark")}>
          ★
        </span>
      </span>
    )),
    ...highest.map((ability) => <span key={`high-${ability}`}>{t("party.brings.highest", { ability: gameName(data, lang, "ability", ability) })}</span>),
  ];
  if (items.length === 0) return <p className="sub">{t("party.brings.nothing", { level })}</p>;
  return (
    <p className="contrib">
      {items.flatMap((item, i) => (i === 0 ? [item] : [<span key={`sep-${i}`} className="sep" aria-hidden="true">·</span>, item]))}
    </p>
  );
}

type Props = {
  character: Character;
  /** What the member brings to the active group (`contribution()`). */
  contribution: Contribution;
  /** The level reached. */
  level: number;
  data: GameData;
  lang: Lang;
  /** Whether the member is the only active one: nothing to compare with. */
  alone: boolean;
  /** The group's best value of each skill (`coverage().best.value`), shown with the skills where the member is best. */
  skillValues: Record<string, number>;
  /** Choices still to make in the member's whole plan. */
  undecided: number;
  onOpen: () => void;
};

/** One active member: classes at the level reached, identity, abilities, what it brings to the group and its level-12 plan. */
export default function MemberCard({ character, contribution, level, data, lang, alone, skillValues, undecided, onOpen }: Props) {
  const { t } = useI18n();
  const cut = truncate(character, level);
  const totals = abilityTotals(cut, data, cut.levels.length);
  const race = identityName(data, lang, "race", character.subrace ?? character.race);
  const background = identityName(data, lang, "background", character.background);
  const identity = [race, background].filter((part) => part !== null).join(" · ");

  return (
    <article className="card member">
      <div className="top">
        <div>
          <h3 className="name">{characterLabel(data, lang, character.who, t("party.player"))}</h3>
          <p className="cls">
            <ClassLine character={character} level={level} data={data} lang={lang} none={t("party.noClass")} />
          </p>
          {identity !== "" && <p className="note">{identity}</p>}
        </div>
        <span className={`pill ${undecided === 0 ? "muted" : "todo"}`}>{undecided === 0 ? t("party.decided") : t(undecided === 1 ? "party.undecided.one" : "party.undecided", { count: undecided })}</span>
      </div>
      <AbilityTiles totals={totals} highest={contribution.highest} data={data} lang={lang} />
      <div className="brings">
        <h4>{t("party.brings")}</h4>
        <BringsText contribution={contribution} alone={alone} skillValues={skillValues} level={level} data={data} lang={lang} />
      </div>
      <p className="plan">{t("party.plan", { level: MAX_LEVELS, classes: classLineText(character, MAX_LEVELS, data, lang) || t("party.noClass") })}</p>
      <button className="btn small open" onClick={onOpen}>
        {t("party.openBuild")}
      </button>
    </article>
  );
}
