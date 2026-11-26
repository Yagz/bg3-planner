import type { GameData } from "../../../../src/data/types.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { backgroundTraits, identityTraits } from "../../../../src/engine/traits.ts";
import { isOffData } from "../../../../src/plan/model.ts";
import type { Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";
import { isScoreIssue } from "./Abilities.tsx";
import IssueList from "./IssueList.tsx";
import { TraitList } from "./Traits.tsx";

export type IdentityField = "race" | "subrace" | "background";

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues outside any level (identity, point buy, number of levels). */
  issues: Issue[];
  /** Whether the origin imposes race, subrace and background. */
  locked: boolean;
  /** Whether the current race offers subraces in the game data. */
  hasSubraces: boolean;
  onPick: (field: IdentityField) => void;
  /** For the player only: the run's origin (`""` for the custom player), the origins offered, and what choosing one does. */
  origin?: { value: string; options: string[]; onChange: (origin: string) => void };
};

/** The creation block: the origin (player only), race, subrace and background. */
export default function Creation({ data, character, issues, locked, hasSubraces, onPick, origin }: Props) {
  const { t, lang } = useI18n();

  const field = (name: IdentityField) => {
    const value = character[name];
    const kind = name === "background" ? "background" : "race";
    const shown = isOffData(value) ? value.offData : value === null ? t("character.nothingPicked") : value === "" ? t("character.todo") : gameName(data, lang, kind, value);
    // "To decide" is the engine's verdict, never recomputed here.
    const todo = issues.some((issue) => issue.code === "choiceMissing" && issue.slot === name);
    // A subrace outside the game data can still be typed in for a race outside it.
    const disabled = locked || (name === "subrace" && !hasSubraces && value === null && !isOffData(character.race));
    const label = t(`character.${name}`);
    // A value outside the game data, an unset field and an identifier absent from the data carry no trait list.
    const known = typeof value === "string" && value !== "" && Object.hasOwn(name === "background" ? data.rules.backgrounds : data.rules.races, value);
    const description = name === "background" && known ? gameDescription(data, lang, "background", value) : null;
    const traits = !known ? null : name === "background" ? backgroundTraits(data, value) : identityTraits(data, value);
    return (
      <div key={name} className="idcard">
        <div className="top">
          <span className="lbl">{label}</span>
          <button className={`pick${todo ? " todo" : ""}`} aria-label={t("character.changeField", { label, value: todo ? t("character.todo") : shown })} disabled={disabled} onClick={() => onPick(name)}>
            {t("character.change")}
          </button>
        </div>
        <span className={`val${todo ? " todo" : ""}`} aria-hidden="true">
          {todo ? t("character.todo") : shown}
        </span>
        <IssueList data={data} issues={issues.filter((issue) => issue.slot === name)} />
        {description !== null && <p className="trait sub">{description}</p>}
        {traits !== null && <TraitList data={data} traits={traits} descriptions />}
      </div>
    );
  };

  return (
    <section className="frame creation" aria-label={t("character.creation")}>
      <div className="row">
        <h2>{t("character.creation")}</h2>
        {locked && <span className="pill muted">{t("character.locked")}</span>}
      </div>
      {origin !== undefined && (
        <div className="row">
          <label className="choice">
            <span className="k">{t("character.origin")}</span>
            <select value={origin.value} onChange={(event) => origin.onChange(event.target.value)}>
              {/* The custom player (run origin "") under the game's own name for its Generic origin. */}
              <option value="">{gameName(data, lang, "origin", "Generic")}</option>
              {origin.options.map((name) => (
                <option key={name} value={name}>
                  {gameName(data, lang, "origin", name)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="ident">{(["race", "subrace", "background"] as const).map(field)}</div>
      <IssueList data={data} issues={issues.filter((issue) => issue.slot === null && !isScoreIssue(issue))} />
    </section>
  );
}
