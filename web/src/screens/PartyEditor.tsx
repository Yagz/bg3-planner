import { useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import type { PartyStatus, Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import { ACTS, STATUSES, addCharacter, copyPartyFromPreviousAct, isRecruitable, setActive, setStatus } from "../state/partyOps.ts";
import type { Act } from "../state/partyOps.ts";

type Props = { run: Run; data: GameData; onChange: (next: Run) => void };

/** Edits the party act by act: who is active, each member's status, copying the previous act, adding characters. */
export default function PartyEditor({ run, data, onChange }: Props) {
  const { t, lang } = useI18n();
  const [act, setAct] = useState<Act>(run.progress.act);
  const [adding, setAdding] = useState("");
  const party = run.party[String(act) as "1" | "2" | "3"];
  const full = party.active.length >= run.partySize;
  const label = (who: string) => characterLabel(data, lang, who, t("party.player"));

  const toggle = (id: string, on: boolean) =>
    onChange(setActive(run, act, on ? [...party.active, id] : party.active.filter((other) => other !== id)));

  const present = new Set(run.characters.map((character) => character.who));
  const candidates = [
    ...(present.has("player") ? [] : [{ who: "player", name: t("party.player") }]),
    ...Object.keys(data.rules.origins)
      .filter((origin) => isRecruitable(data, origin) && !present.has(origin))
      .map((origin) => ({ who: origin, name: gameName(data, lang, "origin", origin) })),
  ];
  const add = () => {
    if (adding === "") return;
    onChange(addCharacter(run, data, adding));
    setAdding("");
  };

  return (
    <section className="editor" aria-label={t("party.editor")}>
      <h2>{t("party.editor")}</h2>
      <div role="tablist" aria-label={t("party.editor.acts")} className="seg">
        {ACTS.map((n) => (
          <button key={n} role="tab" aria-selected={act === n} className={act === n ? "on" : ""} onClick={() => setAct(n)}>
            {t("party.act", { act: n })}
          </button>
        ))}
      </div>
      <p className="sub">{t("party.editor.active", { act, count: party.active.length, max: run.partySize })}</p>
      {run.characters.length === 0 && <p className="sub">{t("party.editor.noCharacter")}</p>}
      <ul className="roster">
        {run.characters.map((character) => {
          const name = label(character.who);
          const active = party.active.includes(character.id);
          return (
            <li key={character.id}>
              <label>
                <input type="checkbox" checked={active} disabled={!active && full} onChange={(event) => toggle(character.id, event.target.checked)} />
                {name}
              </label>
              <select
                aria-label={`${t("party.editor.status", { act })}: ${name}`}
                value={party.status[character.id] ?? ""}
                onChange={(event) => onChange(setStatus(run, act, character.id, event.target.value as PartyStatus))}
              >
                {party.status[character.id] === undefined && <option value="">{t("party.editor.noStatus")}</option>}
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`status.${status}`)}
                  </option>
                ))}
              </select>
            </li>
          );
        })}
      </ul>
      <div className="row">
        {act > 1 && (
          <button className="btn" disabled={party.active.length > 0} onClick={() => onChange(copyPartyFromPreviousAct(run, act))}>
            {t("party.editor.copy")}
          </button>
        )}
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
