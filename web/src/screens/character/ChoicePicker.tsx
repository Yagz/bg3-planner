import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { TextKind } from "../../../../src/data/names.ts";
import type { ChoiceList, GameData } from "../../../../src/data/types.ts";
import { SWAP_SEPARATOR } from "../../../../src/engine/choices.ts";
import { isOffData } from "../../../../src/plan/model.ts";
import type { Ability, Choice } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import type { Lang, Translate } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";

/**
 * How picks are made: a set of distinct entries (`min` to `max`), one entry, distinct entries in order (the i-th gets
 * `bonuses[i]`), or `count` increments with at most `max` on one entry.
 */
export type PickerMode =
  | { type: "set"; min: number; max: number }
  | { type: "single" }
  | { type: "bonus"; bonuses: number[] }
  | { type: "increments"; count: number; max: number };

export type PickerSpec = {
  title: string;
  /** The game's list, in its order. */
  items: string[];
  /** Kind of the entries' names; null for a bare identifier. */
  kind: TextKind | null;
  mode: PickerMode;
  /** For a `SelectSpells` slot that allows replacements: how many, and the spells known before (what may be replaced). */
  swaps?: { max: number; known: string[] };
  /** For a `SelectSpells` slot: entries grouped by spell level, each with the ability the slot's spells are cast with (null for none). */
  spells?: { ability: Ability | null };
  /** The stored choice; absent when nothing is stored. */
  initial: Choice | undefined;
};

const LIST_KINDS: Record<ChoiceList["type"], TextKind> = { spells: "spell", passives: "passive", skills: "skill", abilities: "ability", equipment: "item" };

/** Kind of the names of a choice list's entries; null for a list the data does not hold. */
export function kindOfList(data: GameData, list: string): TextKind | null {
  return Object.hasOwn(data.rules.lists, list) ? LIST_KINDS[data.rules.lists[list]!.type] : null;
}

/** A spell's level from the data: 0 for a cantrip, null when the data does not know it. */
export function spellLevel(data: GameData, id: string): number | null {
  return Object.hasOwn(data.rules.spells, id) ? (data.rules.spells[id]?.level ?? null) : null;
}

/** A spell's level tag ("lvl 1", "cantrip"), or null when the data does not know its level. */
export function spellLevelTag(data: GameData, t: Translate, id: string): string | null {
  const level = spellLevel(data, id);
  return level === null ? null : level === 0 ? t("spell.cantripShort") : t("spell.levelShort", { level });
}

/** What a spell's chip shows besides its name, as text for screen readers: its level tag and the ability it is cast with. */
export function spellFacts(data: GameData, lang: Lang, t: Translate, id: string, ability: Ability | null): string[] {
  const tag = spellLevelTag(data, t, id);
  return [...(tag === null ? [] : [tag]), ...(ability === null ? [] : [t("spell.castWithInline", { ability: gameName(data, lang, "ability", ability) })])];
}

/** The ability a spell is cast with: its game name, shortened only by the style, the full name in the title. */
export function AbilityBadge({ data, lang, t, ability }: { data: GameData; lang: Lang; t: Translate; ability: Ability }) {
  const name = gameName(data, lang, "ability", ability);
  return (
    <span className="cast" title={t("spell.castWith", { ability: name })}>
      {name}
    </span>
  );
}

type Props = {
  data: GameData;
  spec: PickerSpec;
  onSave: (choice: Choice) => void;
  /** Removes the stored choice; offered only when one is stored. */
  onClear: () => void;
  onClose: () => void;
};

type Swap = { old: string; new: string };

function initialState(spec: PickerSpec) {
  const { initial, mode } = spec;
  const entries = Array.isArray(initial) ? initial : [];
  const picks = entries.filter((entry) => !entry.includes(SWAP_SEPARATOR));
  const swaps = entries
    .filter((entry) => entry.includes(SWAP_SEPARATOR))
    .map((entry): Swap => {
      const cut = entry.indexOf(SWAP_SEPARATOR);
      return { old: entry.slice(0, cut), new: entry.slice(cut + SWAP_SEPARATOR.length) };
    });
  const bonus = mode.type === "bonus" ? mode.bonuses.map((_, i) => picks[i] ?? "") : [];
  return { picks, swaps, bonus, offData: isOffData(initial), offText: isOffData(initial) ? initial.offData : "" };
}

/** Accent- and case-insensitive form for the filter. */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** The game's list for one choice: names and descriptions in the current language, a filter, the counter, and a value outside the game data. */
export default function ChoicePicker({ data, spec, onSave, onClear, onClose }: Props) {
  const { t, lang } = useI18n();
  const id = useId();
  const [state] = useState(() => initialState(spec));
  const [picks, setPicks] = useState<string[]>(state.picks);
  const [swaps, setSwaps] = useState<Swap[]>(state.swaps);
  const [bonus, setBonus] = useState<string[]>(state.bonus);
  const [offData, setOffData] = useState(state.offData);
  const [offText, setOffText] = useState(state.offText);
  const [filter, setFilter] = useState("");
  const opener = useRef<Element | null>(null);
  const first = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    (first.current ?? dialog.current)?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const { mode, kind } = spec;
  const name = (entry: string) => gameName(data, lang, kind, entry);
  const description = (entry: string) => (kind === null ? null : gameDescription(data, lang, kind, entry));
  // Entries already stored but outside the list stay shown, so validating never drops them silently.
  const unique = [...new Set([...spec.items, ...picks])];
  const shown = unique.filter((entry) => filter === "" || folded(name(entry)).includes(folded(filter)));

  const counts = new Map<string, number>();
  for (const entry of picks) counts.set(entry, (counts.get(entry) ?? 0) + 1);

  let count: number;
  let expected: number;
  let ready: boolean;
  switch (mode.type) {
    case "set":
      count = picks.length;
      expected = mode.max;
      ready = count >= mode.min && count <= mode.max;
      break;
    case "single":
      count = picks.length;
      expected = 1;
      ready = count === 1;
      break;
    case "bonus":
      count = bonus.filter((entry) => entry !== "").length;
      expected = mode.bonuses.length;
      ready = count === expected && new Set(bonus).size === bonus.length;
      break;
    case "increments":
      count = picks.length;
      expected = mode.count;
      ready = count === expected && [...counts.values()].every((n) => n <= mode.max);
  }
  // Replacements stored on a slot that allows none (or fewer) stay shown, so they can be removed.
  const swapRules = spec.swaps ?? { max: 0, known: [] };
  const swapsReady = swaps.length <= swapRules.max && swaps.every((swap) => swap.old !== "" && swap.new !== "");
  const valid = offData ? offText.trim() !== "" : ready && swapsReady;

  const save = () => {
    if (!valid) return;
    if (offData) {
      onSave({ offData: offText.trim() });
    } else if (mode.type === "bonus") {
      onSave([...bonus]);
    } else if (mode.type === "increments") {
      onSave(unique.flatMap((entry) => Array.from({ length: counts.get(entry) ?? 0 }, () => entry)));
    } else {
      onSave([...unique.filter((entry) => picks.includes(entry)), ...swaps.map((swap) => `${swap.old}${SWAP_SEPARATOR}${swap.new}`)]);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  const toggle = (entry: string, on: boolean) => {
    if (mode.type === "single") setPicks(on ? [entry] : []);
    else setPicks((previous) => (on ? [...previous, entry] : previous.filter((other) => other !== entry)));
  };
  const step = (entry: string, delta: 1 | -1) => {
    setPicks((previous) => {
      if (delta === 1) return [...previous, entry];
      const at = previous.lastIndexOf(entry);
      return at < 0 ? previous : [...previous.slice(0, at), ...previous.slice(at + 1)];
    });
  };
  const editSwap = (index: number, patch: Partial<Swap>) => setSwaps((previous) => previous.map((swap, i) => (i === index ? { ...swap, ...patch } : swap)));

  const full = mode.type === "set" && picks.length >= mode.max;
  const castWith = spec.spells?.ability ?? null;
  const facts = (entry: string) => (spec.spells === undefined ? [] : spellFacts(data, lang, t, entry, castWith));
  const label = (entry: string) => {
    const text = description(entry);
    const said = facts(entry);
    return (
      <span>
        {said.length > 0 && (
          <span className="sr" id={`${id}-${entry}-spell`}>
            {said.join(", ")}
          </span>
        )}
        <b>{name(entry)}</b>
        {castWith !== null && (
          <>
            {" "}
            <AbilityBadge data={data} lang={lang} t={t} ability={castWith} />
          </>
        )}
        {text !== null && (
          <span className="d" id={`${id}-${entry}`}>
            {text}
          </span>
        )}
      </span>
    );
  };
  const describedBy = (entry: string) => {
    const ids = [...(facts(entry).length > 0 ? [`${id}-${entry}-spell`] : []), ...(description(entry) === null ? [] : [`${id}-${entry}`])];
    return ids.length === 0 ? undefined : ids.join(" ");
  };

  /** One entry of the game's list: a checkbox (a radio for a single pick) with its name and description. */
  const option = (entry: string) => {
    const on = picks.includes(entry);
    const off = !on && full;
    return (
      <label key={entry} className={`opt${off ? " off" : ""}`}>
        <input
          type={mode.type === "single" ? "radio" : "checkbox"}
          name={mode.type === "single" ? id : undefined}
          aria-label={name(entry)}
          aria-describedby={describedBy(entry)}
          checked={on}
          disabled={off}
          onChange={(event) => toggle(entry, event.target.checked)}
        />
        {label(entry)}
      </label>
    );
  };

  const list = () => {
    if (mode.type === "bonus") {
      return mode.bonuses.map((value, i) => (
        <label key={i} className="opt">
          <span className="counter">{`+${value}`}</span>
          <select
            ref={i === 0 ? (element) => void (first.current = element) : undefined}
            aria-label={`+${value}`}
            value={bonus[i] ?? ""}
            onChange={(event) => setBonus((previous) => previous.map((entry, j) => (j === i ? event.target.value : entry)))}
          >
            <option value="">{t("picker.choose")}</option>
            {unique.map((entry) => (
              <option key={entry} value={entry}>
                {name(entry)}
              </option>
            ))}
          </select>
        </label>
      ));
    }
    if (mode.type === "increments") {
      return unique.map((entry) => {
        const n = counts.get(entry) ?? 0;
        return (
          <div key={entry} className="opt step">
            <span className="counter">{n}</span>
            <span>
              {label(entry)}
              <button type="button" className="btn" aria-label={t("picker.less", { name: name(entry) })} disabled={n === 0} onClick={() => step(entry, -1)}>
                −
              </button>{" "}
              <button
                type="button"
                className="btn"
                aria-label={t("picker.more", { name: name(entry) })}
                disabled={n >= mode.max || picks.length >= mode.count}
                onClick={() => step(entry, 1)}
              >
                +
              </button>
            </span>
          </div>
        );
      });
    }
    if (shown.length === 0) return <p className="sub">{t("picker.noResult")}</p>;
    if (spec.spells === undefined) return shown.map(option);
    // Spell levels ascending, cantrips first, spells of unknown level last; names in order within a level.
    const groups = new Map<number | null, string[]>();
    for (const entry of shown) {
      const level = spellLevel(data, entry);
      groups.set(level, [...(groups.get(level) ?? []), entry]);
    }
    const levels = [...groups.keys()].sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b));
    return levels.map((level) => {
      const heading = level === null ? t("spell.unknownLevel") : level === 0 ? t("spell.cantrip") : t("spell.level", { level });
      const headingId = `${id}-level-${level ?? "unknown"}`;
      const entries = [...groups.get(level)!].sort((a, b) => name(a).localeCompare(name(b), lang));
      return (
        <div key={headingId} className="spgroup" role="group" aria-labelledby={headingId}>
          <h3 id={headingId}>{heading}</h3>
          {entries.map(option)}
        </div>
      );
    });
  };

  const amount = mode.type === "set" && mode.min !== mode.max ? t("picker.upTo", { count: mode.max }) : t("picker.take", { count: expected });

  return (
    <div className="scrim" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} className="dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
        <header>
          <h2 id={`${id}-title`}>{spec.title}</h2>
          <span className="sub">
            {amount} · <span className="counter">{`${count} / ${expected}`}</span>
          </span>
        </header>
        <div className="content">
          {(mode.type === "set" || mode.type === "single") && (
            <input
              ref={(element) => void (first.current = element)}
              className="search"
              type="search"
              aria-label={t("picker.filter")}
              placeholder={t("picker.filter")}
              autoComplete="off"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          )}
          <fieldset className="options" disabled={offData}>
            <legend className="sr">{t("picker.options")}</legend>
            {list()}
          </fieldset>
          {(swapRules.max > 0 || swaps.length > 0) && (
            <fieldset className="options swaps" disabled={offData}>
              <legend>{t("picker.swaps", { count: swaps.length, max: swapRules.max })}</legend>
              {swaps.map((swap, i) => (
                <div key={i} className="swap">
                  <select aria-label={t("picker.swapOld")} value={swap.old} onChange={(event) => editSwap(i, { old: event.target.value })}>
                    <option value="">{t("picker.swapOld")}…</option>
                    {[...new Set([...swapRules.known, ...(swap.old === "" ? [] : [swap.old])])].map((entry) => (
                      <option key={entry} value={entry}>
                        {name(entry)}
                      </option>
                    ))}
                  </select>
                  <span aria-hidden="true">→</span>
                  <select aria-label={t("picker.swapNew")} value={swap.new} onChange={(event) => editSwap(i, { new: event.target.value })}>
                    <option value="">{t("picker.swapNew")}…</option>
                    {[...new Set([...spec.items, ...(swap.new === "" ? [] : [swap.new])])].map((entry) => (
                      <option key={entry} value={entry}>
                        {name(entry)}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn" onClick={() => setSwaps((previous) => previous.filter((_, j) => j !== i))}>
                    {t("picker.removeSwap")}
                  </button>
                </div>
              ))}
              <button type="button" className="btn" disabled={swaps.length >= swapRules.max} onClick={() => setSwaps((previous) => [...previous, { old: "", new: "" }])}>
                {t("picker.addSwap")}
              </button>
            </fieldset>
          )}
          <div className="offdata">
            <label className="opt">
              <input
                type="checkbox"
                aria-label={t("picker.offData")}
                aria-describedby={`${id}-offdata`}
                checked={offData}
                onChange={(event) => setOffData(event.target.checked)}
              />
              <span>
                <b>{t("picker.offData")}</b>
                <span className="d" id={`${id}-offdata`}>
                  {t("picker.offDataHint")}
                </span>
              </span>
            </label>
            {offData && <input className="search" aria-label={t("picker.offDataValue")} value={offText} onChange={(event) => setOffText(event.target.value)} />}
          </div>
        </div>
        <footer>
          {spec.initial !== undefined && (
            <button className="btn" onClick={onClear}>
              {t("picker.clear")}
            </button>
          )}
          <button className="btn" onClick={onClose}>
            {t("picker.cancel")}
          </button>
          <button className="btn primary" disabled={!valid} onClick={save}>
            {t("picker.validate")}
          </button>
        </footer>
      </div>
    </div>
  );
}
