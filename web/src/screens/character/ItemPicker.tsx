import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import { itemFirstAct } from "../../../../src/engine/equipment.ts";
import type { Act } from "../../../../src/plan/equipmentSlots.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";
import { rarityClass, rarityName, rarityOf, whereText } from "./itemFacts.ts";

const RARITIES = ["common", "uncommon", "rare", "very rare", "legendary", "story"];

type Props = {
  data: GameData;
  /** The slot's name and the act shown in the title. */
  slotName: string;
  act: Act;
  /** The item ids the slot takes. */
  items: string[];
  /** The slot's effective item, preselected (kept listed when outside `items`, so choosing never drops it silently). */
  current: string | null;
  /** Whether the act stores a value for the slot: only then the previous act can be taken back, and never at act 1. */
  ownValue: boolean;
  onChoose: (item: string) => void;
  onEmpty: () => void;
  onInherit: () => void;
  onClose: () => void;
};

/** Accent- and case-insensitive form for the filter. */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** The items of one equipment slot: filters by name, act and rarity, descriptions of the game, and the three ways to settle the slot for the act. */
export default function ItemPicker({ data, slotName, act, items, current, ownValue, onChoose, onEmpty, onInherit, onClose }: Props) {
  const { t, lang } = useI18n();
  const id = useId();
  const [picked, setPicked] = useState<string | null>(current);
  const [filter, setFilter] = useState("");
  const [upTo, setUpTo] = useState(false);
  const [rarity, setRarity] = useState("");
  const opener = useRef<Element | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const dialog = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    (search.current ?? dialog.current)?.focus();
    return () => {
      if (opener.current instanceof HTMLElement) opener.current.focus();
    };
  }, []);

  const entries = useMemo(() => {
    const ids = current !== null && !items.includes(current) ? [current, ...items] : items;
    return ids.map((item) => ({ id: item, name: gameName(data, lang, "item", item), description: gameDescription(data, lang, "item", item), where: whereText(data, t, item, true), ...rarityOf(data, item), first: itemFirstAct(item, data) })).sort((a, b) => a.name.localeCompare(b.name, lang));
  }, [data, lang, t, items, current]);
  const shown = entries.filter((entry) => {
    if (filter !== "" && !folded(entry.name).includes(folded(filter))) return false;
    if (upTo && entry.first !== null && entry.first > Number(act)) return false;
    return rarity === "" || entry.rarity === rarity;
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div className="scrim" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialog} tabIndex={-1} className="dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown}>
        <header>
          <h2 id={`${id}-title`}>{t("equipment.picker.title", { slot: slotName, act })}</h2>
          <span className="sub">{t("equipment.picker.help")}</span>
        </header>
        <div className="content">
          <div className="eqfilters">
            <input ref={search} className="search" type="search" aria-label={t("equipment.picker.filter")} placeholder={t("equipment.picker.filter")} autoComplete="off" value={filter} onChange={(event) => setFilter(event.target.value)} />
            <select aria-label={t("equipment.picker.acts")} value={upTo ? "upTo" : "all"} onChange={(event) => setUpTo(event.target.value === "upTo")}>
              <option value="all">{t("equipment.picker.allActs")}</option>
              <option value="upTo">{t("equipment.picker.upTo", { act })}</option>
            </select>
            <select aria-label={t("equipment.picker.rarity")} value={rarity} onChange={(event) => setRarity(event.target.value)}>
              <option value="">{t("equipment.picker.allRarities")}</option>
              {RARITIES.map((name) => (
                <option key={name} value={name}>
                  {rarityName(t, name)}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="options">
            <legend className="sr">{t("equipment.picker.items")}</legend>
            {shown.length === 0 && <p className="sub">{t("picker.noResult")}</p>}
            {shown.map((entry) => (
              <label key={entry.id} className="opt">
                <input type="radio" name={id} aria-label={entry.name} aria-describedby={`${id}-${entry.id}`} checked={picked === entry.id} onChange={() => setPicked(entry.id)} />
                <span>
                  <b className={rarityClass(entry.rarity)}>{entry.name}</b>
                  {entry.rarity !== null && <span className="d">{rarityName(t, entry.rarity)}</span>}
                  <span className="d" id={`${id}-${entry.id}`}>
                    {entry.where}
                    {entry.description !== null && ` — ${entry.description}`}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </div>
        <footer>
          <button type="button" className="btn" onClick={onEmpty}>
            {t("equipment.picker.empty")}
          </button>
          {ownValue && act !== "1" && (
            <button type="button" className="btn" onClick={onInherit}>
              {t("equipment.picker.inherit")}
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            {t("picker.cancel")}
          </button>
          <button type="button" className="btn primary" disabled={picked === null} onClick={() => picked !== null && onChoose(picked)}>
            {t("equipment.picker.choose")}
          </button>
        </footer>
      </div>
    </div>
  );
}
