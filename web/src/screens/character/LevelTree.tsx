import type { GameData } from "../../../../src/data/types.ts";
import { grantedFeatures } from "../../../../src/engine/features.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { levelSlots } from "../../../../src/engine/validate.ts";
import type { Character, Choice } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import IssueList from "./IssueList.tsx";
import { CLASS_SLOT, LevelClass, SlotPick, classStep, slotRows } from "./LevelList.tsx";

type Props = {
  data: GameData;
  character: Character;
  /** The character's engine issues at a level. */
  issues: Issue[];
  /** Last level played in the run. */
  progressLevel: number;
  /** Whether the run's ruleset allows multiclassing. */
  multiclass: boolean;
  onPick: (level: number, slot: string) => void;
  /** Stores `choice` at a slot directly (an untaken branch); the change goes through the impact preview. */
  onChoose: (level: number, slot: string, choice: Choice) => void;
};

/**
 * The levels as a vertical line of nodes: branch nodes where the class changes (multiclass), a subclass or a feat is taken,
 * and the subclasses the data offers but the build does not take, as dashed buttons that preview the swap.
 */
export default function LevelTree({ data, character, issues, progressLevel, multiclass, onPick, onChoose }: Props) {
  const { t, lang } = useI18n();
  const resolved = resolve(character, data).levels;

  return (
    <div className="tree">
      {resolved.map((level) => {
        const n = level.level;
        const entry = character.levels[n - 1];
        const choices = entry?.choices ?? {};
        const cls = entry?.class ?? "";
        const step = classStep(character, n);
        const slots = levelSlots(level, choices, data);
        const rows = slotRows(slots, data, t);
        const here = issues.filter((issue) => issue.level === n);
        const at = (slot: string) => here.filter((issue) => issue.slot === slot);
        const placed = new Set(rows.map((row) => row.slot));
        const elsewhere = here.filter((issue) => issue.slot === null || !placed.has(issue.slot));
        const undecided = here.filter((issue) => issue.severity === "incomplete").length;
        const played = n <= progressLevel;
        const branch = step === "changes" || slots.subclass !== null || slots.feat !== null;
        const features = grantedFeatures(level, data).map((feature) => gameName(data, lang, feature.kind, feature.id));
        const stored = (slot: string) => (Object.hasOwn(choices, slot) ? choices[slot] : undefined);
        const subclass = slots.subclass === null ? undefined : stored(slots.subclass);
        const untaken = (level.subclassChoice ?? []).filter((name) => !(Array.isArray(subclass) && subclass.includes(name)));
        const className = ["node", branch ? "branch" : "", played ? "played" : "", undecided > 0 ? "hasTodo" : ""].filter((part) => part !== "").join(" ");
        return (
          <div key={n} className={className} role="group" aria-label={t("character.level", { level: n })}>
            <div className="dot" aria-hidden="true">
              {n}
            </div>
            <div className="nbody">
              <div className="ntitle">
                <LevelClass data={data} cls={cls} step={step} classLevel={level.classLevel} multiclass={multiclass} flagged={here.some((issue) => issue.code === "multiclassDisabled")} onPick={() => onPick(n, CLASS_SLOT)} />
                <span className="pill muted">{played ? t("character.played") : t("character.planned")}</span>
                {undecided > 0 && <span className="pill todo">{t("character.undecided", { count: undecided })}</span>}
              </div>
              {rows.map((row) => (
                <div key={row.slot} className="choice">
                  <span className="k">{row.label}</span>
                  <SlotPick data={data} row={row} choice={stored(row.slot)} onPick={() => onPick(n, row.slot)} />
                  <IssueList data={data} issues={at(row.slot)} />
                  {row.slot === slots.subclass && untaken.length > 0 && (
                    <div className="alts" role="group" aria-label={t("tree.untaken")}>
                      <span className="lbl" aria-hidden="true">
                        {t("tree.untaken")}
                      </span>
                      {untaken.map((name) => (
                        <button key={name} className="alt" onClick={() => onChoose(n, row.slot, [name])}>
                          {gameName(data, lang, "class", name)}
                          {level.unlockedSubclasses.includes(name) && <small> ({t("tree.unlockedInPlay")})</small>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {features.length > 0 && (
                <div className="feat">
                  {t("character.granted")} <b>{features.join(", ")}</b>
                </div>
              )}
              <IssueList data={data} issues={elsewhere} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
