import { useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import { ACTS, addCharacter, isRecruitable, overFullActs, setActive } from "../state/partyOps.ts";
import type { Act } from "../state/partyOps.ts";
import { classLineText } from "./party/MemberCard.tsx";

type Props = {
  run: Run;
  data: GameData;
  apply: (operation: (run: Run) => Run) => void;
  /** The act shown, held by the Party screen. */
  act: Act;
  setAct: (act: Act) => void;
};

/** Composes the party act by act: who goes adventuring, who waits at camp, and the characters of the run (the party size lives in the run frame). */
export default function PartyEditor({ run, data, apply, act, setAct }: Props) {
  const { t, lang } = useI18n();
  const [adding, setAdding] = useState("");
  const party = run.party[String(act) as "1" | "2" | "3"];
  const full = party.active.length >= run.partySize;
  const label = (who: string) => characterLabel(data, lang, who, t("party.player"));

  const toggle = (id: string, on: boolean) =>
    apply((current) => setActive(current, act, on ? [...party.active, id] : party.active.filter((other) => other !== id)));

  const present = new Set(run.characters.map((character) => character.who));
  const candidates = [
    ...(present.has("player") ? [] : [{ who: "player", name: t("party.player") }]),
    ...Object.keys(data.rules.origins)
      // The player's own origin is never also a companion.
      .filter((origin) => isRecruitable(data, origin) && !present.has(origin) && origin !== run.origin)
      .map((origin) => ({ who: origin, name: gameName(data, lang, "origin", origin) })),
  ];
  const add = () => {
    if (adding === "") return;
    apply((current) => addCharacter(current, data, adding));
    setAdding("");
  };
  // Active members first, in party order, then those at camp.
  const roster = [
    ...party.active.flatMap((id) => run.characters.filter((character) => character.id === id).slice(0, 1)),
    ...run.characters.filter((character) => !party.active.includes(character.id)),
  ];

  return (
    <section className="frame composer" aria-labelledby="composer-title">
      <div className="head">
        <h2 id="composer-title">{t("party.compose")}</h2>
        <div role="tablist" aria-label={t("party.editor.acts")} className="seg">
          {ACTS.map((n) => (
            <button key={n} role="tab" aria-selected={act === n} className={act === n ? "on" : ""} onClick={() => setAct(n)}>
              {t("party.act", { act: n })}
            </button>
          ))}
        </div>
        <span className="note count">{party.active.length} / {run.partySize}</span>
        <span className="note">{t("party.composer.help")}</span>
      </div>
      {overFullActs(run).map((over) => (
        <p key={over}>
          <span className="pill bad">{t("party.editor.overFull", { act: over, count: run.party[String(over) as "1" | "2" | "3"].active.length, max: run.partySize })}</span>
        </p>
      ))}
      {run.characters.length === 0 && <p className="sub">{t("party.editor.noCharacter")}</p>}
      <ul className="roster">
        {roster.map((character) => {
          const active = party.active.includes(character.id);
          return (
            <li key={character.id}>
              <label>
                <input type="checkbox" checked={active} disabled={!active && full} onChange={(event) => toggle(character.id, event.target.checked)} />
                {label(character.who)}
              </label>
              <span className="note cls">{classLineText(character, run.progress.level, data, lang)}</span>
              <span className="note state">{active ? t("party.composer.inGroup") : t("party.composer.atCamp")}</span>
            </li>
          );
        })}
      </ul>
      <div className="row add">
        <select aria-label={t("party.editor.add")} value={adding} onChange={(event) => setAdding(event.target.value)}>
          <option value="">{t("party.editor.choose")}</option>
          {candidates.map((candidate) => (
            <option key={candidate.who} value={candidate.who}>
              {candidate.name}
            </option>
          ))}
        </select>
        <button className="btn primary" disabled={adding === ""} onClick={add}>
          {t("party.editor.addButton")}
        </button>
      </div>
    </section>
  );
}
