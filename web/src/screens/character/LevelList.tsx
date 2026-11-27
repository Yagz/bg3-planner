import { Fragment, useMemo, useState } from "react";
import type { TextKind } from "../../../../src/data/names.ts";
import type { GameData } from "../../../../src/data/types.ts";
import { castingAbilities, spellSources } from "../../../../src/engine/casting.ts";
import { SWAP_SEPARATOR } from "../../../../src/engine/choices.ts";
import { grantedFeatures } from "../../../../src/engine/features.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { PREPARED_SLOT, preparedState } from "../../../../src/engine/prepared.ts";
import type { PreparedState } from "../../../../src/engine/prepared.ts";
import { resolve } from "../../../../src/engine/progression.ts";
import { isOptionalSelector, levelSlots } from "../../../../src/engine/validate.ts";
import type { LevelSlots, SelectorSlot } from "../../../../src/engine/validate.ts";
import { ABILITIES, isOffData } from "../../../../src/plan/model.ts";
import type { Ability, Character, Choice, OffData } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import type { Lang, Translate } from "../../i18n/i18n.ts";
import { gameName } from "../../names.ts";
import { kindOfList, spellFacts, spellLevel } from "./ChoicePicker.tsx";
import Menu from "../../ui/Menu.tsx";
import type { MenuItem } from "../../ui/Menu.tsx";
import { classesAt, shortAbility } from "../party/MemberCard.tsx";
import IssueList from "./IssueList.tsx";

/** The slot `class` stands for the class taken at the level, as in the engine's issues. */
export const CLASS_SLOT = "class";

/** One choice row of a level: its slot, label, kind of names, whether it may stay unset, and whether it picks spells (`SelectSpells`). */
export type SlotRow = { slot: string; label: string; kind: TextKind | null; optional: boolean; spells: boolean; settledIn: "abilities" | null };

/** The choice rows of a level's slots, in the engine's order: subclass, row selectors, then the feat and its selectors. */
export function slotRows(slots: LevelSlots, data: GameData, t: Translate, level: number): SlotRow[] {
  const rows: SlotRow[] = [];
  if (slots.subclass !== null) rows.push({ slot: slots.subclass, label: t("choice.subclass"), kind: "class", optional: false, spells: false, settledIn: null });
  const selectorRow = ({ id, selector }: SelectorSlot): SlotRow => ({
    slot: id,
    label: "count" in selector && selector.count > 0 ? `${t(`choice.${selector.function}`)} (${selector.count})` : t(`choice.${selector.function}`),
    kind: kindOfList(data, selector.list),
    optional: isOptionalSelector(selector),
    spells: selector.function === "SelectSpells",
    // The level-1 +2 / +1 is chosen in the Abilities frame, as at the game's character creation.
    settledIn: level === 1 && selector.function === "SelectAbilityBonus" ? "abilities" : null,
  });
  rows.push(...slots.selectors.map(selectorRow));
  if (slots.feat !== null) {
    rows.push({ slot: slots.feat.id, label: t("choice.feat"), kind: "feat", optional: false, spells: false, settledIn: null });
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

/**
 * A spell as a chip: its level on the left (the digit, `m` for a cantrip, nothing when the data does not know it), its
 * name (`label` replaces it, for a swap shown as `old → new`), then the ability it is cast with, written out in the
 * brass badge and never clipped; `isNew` marks a spell added at this level. The tooltip says all of it in a sentence.
 */
export function SpellChip({ data, spell, ability, isNew = false, label }: { data: GameData; spell: string; ability: Ability | null; isNew?: boolean; label?: string }) {
  const { t, lang } = useI18n();
  const level = spellLevel(data, spell);
  const facts = [level === null ? null : level === 0 ? t("spell.tipCantrip") : t("spell.tipLevel", { level }), ability === null ? null : t("spell.castWithInline", { ability: gameName(data, lang, "ability", ability) })].filter((part) => part !== null);
  return (
    <span className={`sp${isNew ? " new" : ""}`} title={facts.length === 0 ? undefined : facts.join(", ")}>
      {level !== null && <span className="lvl">{level === 0 ? t("spell.cantripMark") : level}</span>}
      {label ?? gameName(data, lang, "spell", spell)}
      {ability !== null && <span className="cast">{shortAbility(data, lang, ability)}</span>}
      {isNew && <span className="tag">{t("spell.new")}</span>}
    </span>
  );
}

/**
 * The button of one slot: its picks by name, a dashed "to decide", or "optional" for a slot that may stay unset. A
 * spell slot shows one chip per pick: the spell's level (none when the data does not know it), its name (a replacement
 * as `old → new`, tagged with the new spell's level), and the ability it is cast with (`ability`, null for none).
 */
export function SlotPick({ data, row, choice, ability = null, onPick }: { data: GameData; row: SlotRow; choice: Choice | undefined; ability?: Ability | null; onPick: () => void }) {
  const { t, lang } = useI18n();
  if (row.settledIn !== null) return <span className="feat">{t("character.settledInAbilities")}</span>;
  const todo = t("character.todo");
  let shown: string;
  let className = "pick";
  if (choice === undefined || choice === "todo") {
    shown = row.optional && choice === undefined ? t("character.optional") : todo;
    if (shown === todo) className += " todo";
  } else {
    shown = choiceText(data, lang, row.kind, choice, t("character.nothingPicked"));
  }
  const chips = row.spells && Array.isArray(choice) && choice.length > 0;
  // A replacement is tagged with the new spell's level.
  const spellOf = (entry: string) => {
    const cut = entry.indexOf(SWAP_SEPARATOR);
    return cut < 0 ? entry : entry.slice(cut + SWAP_SEPARATOR.length);
  };
  const chip = (entry: string, i: number) => <SpellChip key={i} data={data} spell={spellOf(entry)} label={choiceText(data, lang, row.kind, [entry], "")} ability={ability} />;
  // Screen readers hear each chip whole: "Healing Word, lvl 1, cast with Charisma; Sleep, …".
  const said = chips ? choice.map((entry) => [choiceText(data, lang, row.kind, [entry], ""), ...spellFacts(data, lang, t, spellOf(entry), ability)].join(", ")).join("; ") : shown;
  return (
    <button className={chips ? `${className} spells` : className} aria-label={`${row.label}: ${said}`} onClick={onPick}>
      {chips ? choice.map(chip) : shown}
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

/** How the class of a level relates to the level before: the first level, a level that continues it, one that changes it, or a class still to decide on either side. */
export type ClassStep = "first" | "continues" | "changes" | "undecided";

/** The step of level `level` (1-based); a value outside the game data compares by its text. */
export function classStep(character: Character, level: number): ClassStep {
  if (level <= 1) return "first";
  const key = (cls: string | OffData | undefined) => (cls === undefined ? "" : isOffData(cls) ? `offData:${cls.offData}` : cls);
  const now = key(character.levels[level - 1]?.class);
  const before = key(character.levels[level - 2]?.class);
  if (now === "" || before === "") return "undecided";
  return now === before ? "continues" : "changes";
}

/**
 * The class of a level: a pick for the first level, an undecided class or a level that changes class (marked
 * "multiclass"); a level that continues the previous class shows it muted with "Multiclass", which opens the class
 * picker. Neither mark nor button when the run's ruleset forbids multiclassing; a level the engine flags for it
 * (`flagged`) keeps its class pick, so it can be set back. In a list row (`inRow`) neither the button nor the pill is
 * drawn: the row has its own tags and its level menu changes the class.
 */
export function LevelClass({ data, cls, step, classLevel, multiclass, flagged, onPick, inRow = false }: { data: GameData; cls: string | OffData; step: ClassStep; classLevel: number; multiclass: boolean; flagged: boolean; onPick: () => void; inRow?: boolean }) {
  const { t, lang } = useI18n();
  const counter = classLevel > 0 && <span className="counter">{classLevel}</span>;
  if (step === "continues" && !flagged) {
    return (
      <>
        <span className="same">{isOffData(cls) ? cls.offData : gameName(data, lang, "class", cls)}</span> {counter}
        {multiclass && !inRow && (
          <button className="btn small" onClick={onPick}>
            {t("character.multiclass")}
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <ClassPick data={data} cls={cls} onPick={onPick} /> {counter}
      {/* No pill when the ruleset forbids multiclassing: the engine flags each such level with its own message. */}
      {step === "changes" && multiclass && !inRow && <span className="pill acc">{t("tree.multiclass")}</span>}
    </>
  );
}

/** What a level grants, as one line: the first `limit` names, then a button « and n more » that shows the rest. */
export function GrantedList({ names, limit = 6 }: { names: string[]; limit?: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (names.length === 0) return null;
  const folded = !open && names.length > limit;
  return (
    <div className="granted">
      {t("character.granted")} <b>{(folded ? names.slice(0, limit) : names).join(", ")}</b>
      {folded && (
        <>
          {" "}
          <button type="button" className="linkbtn" onClick={() => setOpen(true)}>
            {t("character.grantedMore", { count: names.length - limit })}
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The prepared spells of one level, for the class it takes: a count chip (good when met, to decide when short, bad when
 * over) with the formula, the effective list as chips (the level's own, or the previous level's, said so), the spells
 * always prepared apart (`before`: the list the class had at its previous level), and the buttons to edit the list or to take the previous level's list again. A class that
 * does not prepare shows "all prepared" when it casts (`casts`: the class or its subclass gives spells at this level); a leftover list on one is an issue with a button that clears it.
 */
export function PreparedBlock({ data, character, level, state, casts, before, issues, onEdit, onInherit }: { data: GameData; character: Character; level: number; state: PreparedState | null; casts: boolean; before: { list: string[]; from: number } | null; issues: Issue[]; onEdit: () => void; onInherit: () => void }) {
  const { t, lang } = useI18n();
  const own = character.levels[level - 1]?.prepared !== undefined;
  const cls = character.levels[level - 1]?.class ?? "";
  if (state === null) {
    if (own && issues.some((issue) => issue.code === "preparedNotOffered")) {
      return (
        <>
          <span className="lab">{t("prepared.title")}</span>
          <div className="val">
            <IssueList data={data} issues={issues} />
            <button type="button" className="btn small" onClick={onInherit}>
              {t("prepared.clearList")}
            </button>
          </div>
        </>
      );
    }
    if (!casts) return null;
    return (
      <>
        <span className="lab">{t("prepared.title")}</span>
        <div className="val">
          <span className="feat">{t("prepared.all")}</span>
        </div>
      </>
    );
  }
  const ability = (ABILITIES as readonly string[]).includes(data.rules.classes[state.cls]?.spellcasting_ability ?? "") ? (data.rules.classes[state.cls]!.spellcasting_ability as Ability) : null;
  const { list, count, pool, always } = state;
  if (list === null && pool.length === 0 && always.length === 0) return null;
  const n = list?.length ?? 0;
  const tone = n > count ? "bad" : n < Math.min(count, pool.length) ? "todo" : "good";
  const formula = t(state.cls === "Wizard" ? "prepared.formulaWizard" : "prepared.formula", { class: gameName(data, lang, "class", state.cls), level: state.classLevel, ability: ability === null ? "" : gameName(data, lang, "ability", ability) });
  return (
    <>
      <span className="lab">{t("prepared.title")}</span>
      <div className="val prepared">
        <div className="prephead">
          <span className={`pill ${tone}`} aria-label={t("prepared.countLabel", { count: n, expected: count })}>
            {`${n} / ${count}`}
          </span>
          <span className="sub">{formula}</span>
        </div>
        {list === null && <span className="feat">{t("prepared.none")}</span>}
        {list !== null && !state.own && <span className="feat">{t("prepared.inherits", { level: state.from ?? 0 })}</span>}
        {list !== null && state.own && list.length === 0 && <span className="feat">{t("prepared.emptyChosen")}</span>}
        {list !== null && list.length > 0 && (
          <div className="chipsrow">
            {list.map((spell) => (
              <SpellChip key={spell} data={data} spell={spell} ability={ability} isNew={state.own && before !== null && !before.list.includes(spell)} />
            ))}
          </div>
        )}
        {always.length > 0 && (
          <div className="always">
            <span className="sub">{t("prepared.always")}</span>
            <div className="chipsrow">
              {always.map((spell) => (
                <SpellChip key={spell} data={data} spell={spell} ability={ability} />
              ))}
            </div>
          </div>
        )}
        <IssueList data={data} issues={issues} />
        <div className="row">
          {pool.length > 0 && (
            <button type="button" className="btn small" onClick={onEdit}>
              {t("prepared.edit")}
            </button>
          )}
          {state.own && (
            <button type="button" className="btn small" onClick={onInherit}>
              {before === null ? t("prepared.clearList") : t("prepared.inheritFrom", { level: before.from })}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

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
  /** Removes the level's own prepared list, which takes the previous one again (or just clears it). */
  onInherit: (level: number) => void;
  /** Removes the last level (through the impact preview). */
  onRemove: () => void;
};

/**
 * One row per level in four parts: the level number, the class block (class and level, subclass, played or planned, multiclass),
 * the choices (picks or a dashed "to decide", the engine's issues under their pick, what the level grants) and a level menu
 * (change the class at this level; remove the level on the last row).
 */
export default function LevelList({ data, character, issues, progressLevel, multiclass, onPick, onInherit, onRemove }: Props) {
  const { t, lang } = useI18n();
  const resolved = resolve(character, data).levels;
  const abilities = castingAbilities(character, data);
  // One resolution per level for the whole list; the previous list of each level's class comes from the states before it.
  const prepared = useMemo(() => resolved.map((_, i) => preparedState(character, data, i + 1)), [character, data]); // eslint-disable-line react-hooks/exhaustive-deps
  // Whether each level's class gives spells at that point, from the class or its subclass (only asked where nothing is prepared).
  const casting = useMemo(
    () => resolved.map((level, i) => prepared[i] === null && level.class !== "" && spellSources(character, data, i + 1).some((source) => source.kind === "class" && source.id === level.class)),
    [character, data], // eslint-disable-line react-hooks/exhaustive-deps
  );

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
        const preparedHere = here.filter((issue) => issue.slot === PREPARED_SLOT);
        const state = prepared[n - 1] ?? null;
        let before: { list: string[]; from: number } | null = null;
        for (let i = n - 2; i >= 0 && state !== null; i--) {
          const earlier = prepared[i];
          if (earlier?.cls === state.cls && earlier.list !== null && earlier.from !== null) {
            before = { list: earlier.list, from: earlier.from };
            break;
          }
        }
        const rows = slotRows(slots, data, t, n);
        const placed = new Set(rows.map((row) => row.slot));
        const elsewhere = here.filter((issue) => issue.slot !== PREPARED_SLOT && (issue.slot === null || !placed.has(issue.slot)));
        const features = grantedFeatures(level, data).map((feature) => gameName(data, lang, feature.kind, feature.id));
        const played = n <= progressLevel;
        const cls = entry?.class ?? "";
        const step = classStep(character, n);
        const flagged = here.some((issue) => issue.code === "multiclassDisabled");
        const subclass = isOffData(cls) || cls === "" ? null : (classesAt(character, n, data, lang).find((classes) => classes.cls === cls)?.subclass ?? null);
        const items: MenuItem[] = [];
        if (multiclass && n > 1) items.push({ label: t("character.changeClassHere"), onSelect: () => onPick(n, CLASS_SLOT) });
        if (n === resolved.length && n > 1) items.push({ label: t("character.removeLevel", { level: n }), onSelect: onRemove, danger: true, separatorBefore: items.length > 0 });
        return (
          <Fragment key={n}>
            {n === firstUpcoming && <div className="divider">{t("character.upcoming", { level: progressLevel })}</div>}
            <div className={`lv${played ? " played" : ""}`} role="group" aria-label={t("character.level", { level: n })}>
              {/* The planned numbers are pale: the row's pill says played or planned in text. */}
              <span className="n" aria-hidden="true">
                {String(n).padStart(2, "0")}
              </span>
              <div className="klass">
                <b>
                  <LevelClass data={data} cls={cls} step={step} classLevel={level.classLevel} multiclass={multiclass} flagged={flagged} onPick={() => onPick(n, CLASS_SLOT)} inRow />
                </b>
                {subclass !== null && <span className="sub">{subclass}</span>}
                <div className="tags">
                  <span className={`pill ${played ? "good" : "muted"}`}>{played ? t("character.played") : t("character.planned")}</span>
                  {step === "changes" && multiclass && <span className="pill acc">{t("tree.multiclass")}</span>}
                </div>
              </div>
              <div className="picks">
                {rows.map((row) => (
                  <Fragment key={row.slot}>
                    <span className="lab">{row.label}</span>
                    <div className="val">
                      <SlotPick data={data} row={row} choice={Object.hasOwn(choices, row.slot) ? choices[row.slot] : undefined} ability={abilities[n - 1]?.[row.slot] ?? null} onPick={() => onPick(n, row.slot)} />
                      {row.settledIn === null && <IssueList data={data} issues={at(row.slot)} />}
                    </div>
                  </Fragment>
                ))}
                <PreparedBlock data={data} character={character} level={n} state={state} casts={casting[n - 1] ?? false} before={before} issues={preparedHere} onEdit={() => onPick(n, PREPARED_SLOT)} onInherit={() => onInherit(n)} />
                {rows.length === 0 && state === null && preparedHere.length === 0 && <span className="full feat">{t("character.nothingToChoose")}</span>}
                <div className="full">
                  <GrantedList names={features} />
                  <IssueList data={data} issues={elsewhere} />
                </div>
              </div>
              <div className="more">{items.length > 0 && <Menu label={t("character.levelMenu", { level: n })} icon="⋯" items={items} />}</div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
