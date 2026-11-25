import type { GameData } from "../../../../src/data/types.ts";
import { POINT_BUY, abilityTotals, pointsSpent } from "../../../../src/engine/abilities.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { ABILITIES, isOffData } from "../../../../src/plan/model.ts";
import type { Ability, Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import IssueList from "./IssueList.tsx";

export type IdentityField = "race" | "subrace" | "background";

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues outside any level (identity, point buy, number of levels). */
  issues: Issue[];
  /** Whether the origin imposes race, subrace and background. */
  locked: boolean;
  /** Whether the current race offers subraces (or is outside the game data). */
  hasSubraces: boolean;
  onPick: (field: IdentityField) => void;
  onAbility: (ability: Ability, value: number) => void;
};

const BASE_VALUES = Array.from({ length: POINT_BUY.max - POINT_BUY.min + 1 }, (_, i) => POINT_BUY.min + i);

/** The creation block: race, subrace, background, and the six base scores with the level-1 bonus and the point-buy counter. */
export default function Creation({ data, character, issues, locked, hasSubraces, onPick, onAbility }: Props) {
  const { t, lang } = useI18n();
  const totals = abilityTotals(character, data, 1);
  const spent = pointsSpent(character.abilities);

  const field = (name: IdentityField) => {
    const value = character[name];
    const kind = name === "background" ? "background" : "race";
    const shown = isOffData(value) ? value.offData : value === null ? t("character.nothingPicked") : value === "" ? t("character.todo") : gameName(data, lang, kind, value);
    const todo = value === "" || (name === "subrace" && value === null && hasSubraces);
    const disabled = locked || (name === "subrace" && !hasSubraces && value === null);
    const label = t(`character.${name}`);
    return (
      <span key={name} className="choice">
        <span className="k">{label}</span>
        <button className={`pick${todo ? " todo" : ""}`} aria-label={`${label}: ${todo ? t("character.todo") : shown}`} disabled={disabled} onClick={() => onPick(name)}>
          {todo ? t("character.todo") : shown}
        </button>
        <IssueList data={data} issues={issues.filter((issue) => issue.slot === name)} />
      </span>
    );
  };

  return (
    <section className="creation" aria-label={t("character.creation")}>
      <div className="row">
        <h2>{t("character.creation")}</h2>
        {locked && <span className="pill muted">{t("character.locked")}</span>}
      </div>
      <div className="row">{(["race", "subrace", "background"] as const).map(field)}</div>
      <div className="row">
        <span className="k">{t("character.abilities")}</span>
        <span className={`pill ${spent === POINT_BUY.budget ? "good" : spent > POINT_BUY.budget ? "bad" : "todo"}`} aria-label={t("character.pointBuy")}>
          {`${spent} / ${POINT_BUY.budget}`}
        </span>
        <span className="feat">{t("character.abilitiesHint")}</span>
      </div>
      <div className="abil">
        {ABILITIES.map((ability) => {
          const base = character.abilities[ability];
          const bonus = totals[ability] - base;
          const name = gameName(data, lang, "ability", ability);
          const values = BASE_VALUES.includes(base) ? BASE_VALUES : [...BASE_VALUES, base].sort((a, b) => a - b);
          return (
            <div key={ability} className="ab" role="group" aria-label={name}>
              <span className="nm">{name}</span>
              <span className="tot">{totals[ability]}</span>
              <span className="det">
                <select aria-label={t("character.base", { ability: name })} value={base} onChange={(event) => onAbility(ability, Number(event.target.value))}>
                  {values.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
                {bonus !== 0 && <b>{bonus > 0 ? `+${bonus}` : String(bonus)}</b>}
              </span>
            </div>
          );
        })}
      </div>
      <IssueList data={data} issues={issues.filter((issue) => issue.slot === null)} />
    </section>
  );
}
