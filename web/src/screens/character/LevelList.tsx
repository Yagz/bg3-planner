import { Fragment } from "react";
import type { TextKind } from "../../../../src/data/names.ts";
import type { GameData } from "../../../../src/data/types.ts";
import { SWAP_SEPARATOR } from "../../../../src/engine/choices.ts";
import { grantedFeatures } from "../../../../src/engine/features.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { isOptionalSelector, levelSlots } from "../../../../src/engine/validate.ts";
import type { LevelSlots, SelectorSlot } from "../../../../src/engine/validate.ts";
import { isOffData } from "../../../../src/plan/model.ts";
import type { Character, Choice, OffData } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import type { Lang, Translate } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import { kindOfList } from "./ChoicePicker.tsx";
import IssueList from "./IssueList.tsx";

/** The slot `class` stands for the class taken at the level, as in the engine's issues. */
export const CLASS_SLOT = "class";

/** One choice row of a level: its slot, label, kind of names, and whether it may stay unset. */
export type SlotRow = { slot: string; label: string; kind: TextKind | null; optional: boolean };

/** The choice rows of a level's slots, in the engine's order: subclass, row selectors, then the feat and its selectors. */
export function slotRows(slots: LevelSlots, data: GameData, t: Translate): SlotRow[] {
  const rows: SlotRow[] = [];
  if (slots.subclass !== null) rows.push({ slot: slots.subclass, label: t("choice.subclass"), kind: "class", optional: false });
  const selectorRow = ({ id, selector }: SelectorSlot): SlotRow => ({
    slot: id,
    label: "count" in selector && selector.count > 0 ? `${t(`choice.${selector.function}`)} (${selector.count})` : t(`choice.${selector.function}`),
    kind: kindOfList(data, selector.list),
    optional: isOptionalSelector(selector),
  });
  rows.push(...slots.selectors.map(selectorRow));
  if (slots.feat !== null) {
    rows.push({ slot: slots.feat.id, label: t("choice.feat"), kind: "feat", optional: false });
    rows.push(...slots.feat.selectors.map(selectorRow));
  }
  return rows;
}

/** A stored choice as text: its picks by name (a replacement as `old → new`), or the value outside the game data. */
export function choiceText(data: GameData, lang: Lang, kind: TextKind | null, choice: Exclude<Choice, "todo">, nothing: string): string {
  if (isOffData(choice)) return choice.offData;
  if (choice.length === 0) return nothing;
  return choice
    .map((entry) => {
      const cut = entry.indexOf(SWAP_SEPARATOR);
      if (cut < 0) return gameName(data, lang, kind, entry);
      return `${gameName(data, lang, kind, entry.slice(0, cut))} → ${gameName(data, lang, kind, entry.slice(cut + SWAP_SEPARATOR.length))}`;
    })
    .join(", ");
}

/** The button of one slot: its picks by name, a dashed "to decide", or "optional" for a slot that may stay unset. */
export function SlotPick({ data, row, choice, onPick }: { data: GameData; row: SlotRow; choice: Choice | undefined; onPick: () => void }) {
  const { t, lang } = useI18n();
  const todo = t("character.todo");
  let shown: string;
  let className = "pick";
  if (choice === undefined || choice === "todo") {
    shown = row.optional && choice === undefined ? t("character.optional") : todo;
    if (shown === todo) className += " todo";
  } else {
    shown = choiceText(data, lang, row.kind, choice, t("character.nothingPicked"));
  }
  return (
    <button className={className} aria-label={`${row.label}: ${shown}`} onClick={onPick}>
      {shown}
    </button>
  );
}

/** The button of the class taken at a level, or a dashed "to decide". */
export function ClassPick({ data, cls, onPick }: { data: GameData; cls: string | OffData; onPick: () => void }) {
  const { t, lang } = useI18n();
  const shown = isOffData(cls) ? cls.offData : cls === "" ? t("character.todo") : gameName(data, lang, "class", cls);
  return (
    <button className={`pick${cls === "" ? " todo" : ""}`} aria-label={`${t("character.class")}: ${shown}`} onClick={onPick}>
      {shown}
    </button>
  );
}

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues at a level. */
  issues: Issue[];
  /** Last level played in the run. */
  progressLevel: number;
  onPick: (level: number, slot: string) => void;
};

/** One row per level: the class taken, every choice (picks or a dashed "to decide"), what the level grants, and the engine's issues in place. */
export default function LevelList({ data, character, issues, progressLevel, onPick }: Props) {
  const { t, lang } = useI18n();
  const resolved = resolve(character, data).levels;

  const firstUpcoming = resolved.find((level) => level.level > progressLevel)?.level ?? null;

  return (
    <div className="levels">
      {resolved.map((level) => {
        const n = level.level;
        const entry = character.levels[n - 1];
        const choices = entry?.choices ?? {};
        const slots = levelSlots(level, choices, data);
        const here = issues.filter((issue) => issue.level === n);
        const at = (slot: string) => here.filter((issue) => issue.slot === slot);
        const rows = slotRows(slots, data, t);
        const placed = new Set(rows.map((row) => row.slot));
        const elsewhere = here.filter((issue) => issue.slot === null || !placed.has(issue.slot));
        const features = grantedFeatures(level, data).map((feature) => gameName(data, lang, feature.kind, feature.id));
        const played = n <= progressLevel;
        const cls = entry?.class ?? "";
        return (
          <Fragment key={n}>
            {n === firstUpcoming && <div className="divider">{t("character.upcoming", { level: progressLevel })}</div>}
            <div className={`lv${played ? " played" : ""}`} role="group" aria-label={t("character.level", { level: n })}>
              <span className="n">{String(n).padStart(2, "0")}</span>
              <div className="c">
                <ClassPick data={data} cls={cls} onPick={() => onPick(n, CLASS_SLOT)} />{" "}
                {level.classLevel > 0 && <span className="counter">{level.classLevel}</span>}
                <small>{played ? t("character.played") : t("character.planned")}</small>
              </div>
              <div className="body">
                {rows.map((row) => (
                  <div key={row.slot} className="choice">
                    <span className="k">{row.label}</span>
                    <SlotPick data={data} row={row} choice={Object.hasOwn(choices, row.slot) ? choices[row.slot] : undefined} onPick={() => onPick(n, row.slot)} />
                    <IssueList data={data} issues={at(row.slot)} />
                  </div>
                ))}
                {rows.length === 0 && <span className="feat">{t("character.nothingToChoose")}</span>}
                {features.length > 0 && (
                  <div className="feat">
                    {t("character.granted")} <b>{features.join(", ")}</b>
                  </div>
                )}
                <IssueList data={data} issues={elsewhere} />
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
