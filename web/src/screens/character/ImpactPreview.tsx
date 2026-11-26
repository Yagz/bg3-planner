import { useEffect, useId, useRef } from "react";
import { isEquipmentIssue } from "./EquipmentTab.tsx";
import type { KeyboardEvent, ReactNode } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import type { Feature } from "../../../../src/engine/features.ts";
import type { Impact } from "../../../../src/engine/impact.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { levelSlots } from "../../../../src/engine/validate.ts";
import type { Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import type { NameOf, Translate } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import { choiceText, slotRows } from "./LevelList.tsx";
import type { SlotRow } from "./LevelList.tsx";

type Props = {
  data: GameData;
  /** The character as stored, before the change. */
  before: Character;
  impact: Impact;
  /** Saves `impact.result`. */
  onApply: () => void;
  /** Closes the preview; nothing is saved. */
  onCancel: () => void;
};

/** Each feature once (by kind and identifier, at the first level the engine reports it), in the engine's order. */
function unique(features: Feature[]): Feature[] {
  const seen = new Set<string>();
  return features.filter((feature) => {
    const key = `${feature.kind}:${feature.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The choice row of `slot` at `level` of `character`, as the level list shows it; null when the slot is not one of its own. */
function rowOf(character: Character, level: number, slot: string, data: GameData, t: Translate): SlotRow | null {
  const resolved = resolve(character, data).levels[level - 1];
  if (resolved === undefined) return null;
  return slotRows(levelSlots(resolved, character.levels[level - 1]?.choices ?? {}, data), data, t, level).find((row) => row.slot === slot) ?? null;
}

/** The engine's impact of a change before it is applied: features gained and lost, choices opened and removed, later choices made impossible, party coverage. */
export default function ImpactPreview({ data, before, impact, onApply, onCancel }: Props) {
  const { t, lang, issueMessage } = useI18n();
  const id = useId();
  const opener = useRef<Element | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
    }
  };

  const at = (level: number) => t("impact.level", { level });
  const features = (heading: string, className: string, list: Feature[]) => (
    <section className={className} aria-labelledby={`${id}-${className}`}>
      <h3 id={`${id}-${className}`}>{heading}</h3>
      <ul>
        {list.length === 0 ? (
          <li>
            <span />
            {t("impact.nothing")}
          </li>
        ) : (
          unique(list).map((feature) => (
            <li key={`${feature.kind}:${feature.id}`}>
              <span>{at(feature.level)}</span>
              {gameName(data, lang, feature.kind, feature.id)}
            </li>
          ))
        )}
      </ul>
    </section>
  );
  const group = (key: string, heading: string, pills: ReactNode) => (
    <div className="verdict" role="group" aria-labelledby={`${id}-${key}`}>
      <span className="lbl" id={`${id}-${key}`}>
        {heading}
      </span>
      {pills}
    </div>
  );

  const { result, slotsAdded, slotsRemoved, newlyInvalid, coverage } = impact;
  const nameOf: NameOf = (kind, value) => gameName(data, lang, kind, value);

  return (
    <div className="scrim" onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div ref={dialog} tabIndex={-1} className="dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
        <header>
          <h2 id={`${id}-title`}>{t("impact.title")}</h2>
          <span className="sub">{t("impact.source")}</span>
        </header>
        <div className="content">
          <div className="diff">
            {features(t("impact.gained"), "g", impact.gained)}
            {features(t("impact.lost"), "l", impact.lost)}
          </div>
          {slotsAdded.length > 0 &&
            group(
              "added",
              t("impact.added"),
              slotsAdded.map(({ level, slot }) => (
                <span key={`${level}|${slot}`} className="pill acc">
                  {`${at(level)} · ${rowOf(result, level, slot, data, t)?.label ?? slot}`}
                </span>
              )),
            )}
          {slotsRemoved.length > 0 &&
            group(
              "removed",
              t("impact.removed"),
              slotsRemoved.map(({ level, slot, choice }) => {
                const row = rowOf(before, level, slot, data, t);
                const picks = choice === "todo" ? t("character.todo") : choiceText(data, lang, row?.kind ?? null, choice, t("character.nothingPicked"));
                return (
                  <span key={`${level}|${slot}`} className="pill muted">
                    {t("impact.removedPick", { level: at(level), slot: row?.label ?? slot, picks })}
                  </span>
                );
              }),
            )}
          {group(
            "invalid",
            t("impact.invalid"),
            newlyInvalid.length === 0 ? (
              <span className="pill good">{t("impact.noneInvalid")}</span>
            ) : (
              newlyInvalid.map((issue, i) => (
                <span key={i} className="pill bad">
                  {`${issue.level === null ? (isEquipmentIssue(issue) ? t("character.tab.equipment") : t("character.creation")) : at(issue.level)} · ${issueMessage(issue, nameOf)}`}
                </span>
              ))
            ),
          )}
          {group(
            "coverage",
            t("impact.coverage"),
            coverage.gained.length === 0 && coverage.lost.length === 0 ? (
              <span className="pill muted">{t("impact.coverageSame")}</span>
            ) : (
              <>
                {coverage.gained.map((skill) => (
                  <span key={`+${skill}`} className="pill good">{`+ ${gameName(data, lang, "skill", skill)}`}</span>
                ))}
                {coverage.lost.map((skill) => (
                  <span key={`-${skill}`} className="pill bad">{`− ${gameName(data, lang, "skill", skill)}`}</span>
                ))}
              </>
            ),
          )}
        </div>
        <footer>
          <button className="btn" onClick={onCancel}>
            {t("impact.cancel")}
          </button>
          <button className="btn primary" onClick={onApply}>
            {t("impact.apply")}
          </button>
        </footer>
      </div>
    </div>
  );
}
