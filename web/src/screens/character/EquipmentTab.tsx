import { useMemo, useState } from "react";
import type { GameData } from "../../../../src/data/types.ts";
import { effectiveEquipment, itemsForSlot } from "../../../../src/engine/equipment.ts";
import type { Issue } from "../../../../src/engine/issues.ts";
import { EQUIPMENT_SLOTS } from "../../../../src/plan/equipmentSlots.ts";
import type { Act, EquipmentSlot } from "../../../../src/plan/equipmentSlots.ts";
import type { Character } from "../../../../src/plan/model.ts";
import { useI18n } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";
import { inheritEquipment, setEquipment } from "../../state/characterOps.ts";
import ItemPicker from "./ItemPicker.tsx";
import { rarityName, rarityOf, whereText } from "./itemFacts.ts";
import Silhouette from "./Silhouette.tsx";

const ACTS: Act[] = ["1", "2", "3"];
const LEFT: EquipmentSlot[] = ["Helmet", "Cloak", "Breast", "Gloves", "Boots"];
const RIGHT: EquipmentSlot[] = ["Amulet", "Ring", "Ring2", "Underwear"];
const WEAPONS: EquipmentSlot[] = ["MeleeMainHand", "MeleeOffHand", "RangedMainHand", "RangedOffHand"];
const CAMP: EquipmentSlot[] = ["MusicalInstrument", "VanityBody", "VanityBoots"];
const LEGEND = ["common", "uncommon", "rare", "very rare", "legendary"];

/** An equipment issue (the engine writes them with `level: null` and `slot: "equipment:<act>/<Slot>"`), which belongs to this tab, not to character creation. */
export function isEquipmentIssue(issue: Issue): boolean {
  return issue.slot !== null && issue.slot.startsWith("equipment:");
}

/** The act and slot an equipment issue points at; null for any other issue. */
function issueSpot(issue: Issue): { act: string; slot: string } | null {
  if (!isEquipmentIssue(issue)) return null;
  const [act = "", slot = ""] = issue.slot!.slice("equipment:".length).split("/");
  return { act, slot };
}

type Props = {
  data: GameData;
  character: Character;
  /** The engine's equipment issues for this character (over the whole run, so sharing between characters shows), a notice at every act where it holds. */
  issues: Issue[];
  /** Saves the changed character. */
  onChange: (character: Character) => void;
};

/** What a character wears per act: slots around a neutral silhouette, inheritance from the previous act shown, and a picker of the slot's items. */
export default function EquipmentTab({ data, character, issues, onChange }: Props) {
  const { t, lang, issueMessage } = useI18n();
  const [act, setAct] = useState<Act>("1");
  const [slot, setSlot] = useState<EquipmentSlot | null>(null);
  // Re-resolves the character on each call: once per render, not per slot.
  const effective = useMemo(() => effectiveEquipment(character, act, data), [character, act, data]);
  const options = useMemo(() => {
    const result = {} as Record<EquipmentSlot, string[]>;
    for (const name of EQUIPMENT_SLOTS) result[name] = itemsForSlot(name, character, data);
    return result;
  }, [character, data]);
  const own = character.equipment[act] ?? {};
  const changes = Object.keys(own).length;
  const actIssues = issues.filter((issue) => issueSpot(issue)?.act === act);
  const badSlots = new Set(actIssues.filter((issue) => issue.severity === "invalid").map((issue) => issueSpot(issue)!.slot));
  const warned = new Set(actIssues.filter((issue) => issue.severity !== "invalid").map((issue) => issueSpot(issue)!.slot));
  const slotName = (name: EquipmentSlot) => gameName(data, lang, "slot", name);
  const names = (kind: Parameters<typeof gameName>[2], id: string) => gameName(data, lang, kind, id);

  const card = (name: EquipmentSlot) => {
    const { item, source, level } = effective[name];
    const known = options[name].length > 0;
    const openable = known || item !== null || Object.hasOwn(own, name);
    const inherited = source !== null && source !== act;
    const { rarity, className } = item === null ? { rarity: null, className: "" } : rarityOf(data, item);
    const flag = source === "level" ? t("equipment.fromLevel", { level: level ?? 0 }) : inherited ? t("equipment.inherited", { act: source }) : "";
    const where = !known && item === null ? t("equipment.noKnown") : item === null ? t("equipment.choose") : source === "level" ? t("equipment.startPick") : whereText(data, t, item);
    const description = item === null ? null : gameDescription(data, lang, "item", item);
    return (
      <button
        key={name}
        type="button"
        data-slot={name}
        className={`eqslot${item === null ? " empty" : ""}${inherited ? " inh" : ""}${badSlots.has(name) ? " bad" : warned.has(name) ? " warn" : ""}`}
        aria-disabled={openable ? undefined : true}
        title={description ?? undefined}
        onClick={() => openable && setSlot(name)}
      >
        <span className="sl">{slotName(name)}</span>
        {flag !== "" && <span className="flag">{flag}</span>}
        {badSlots.has(name) && <span className="flag badflag">{t("equipment.invalidFlag")}</span>}
        <span className={`it${className === "" ? "" : ` ${className}`}`}>
          {item !== null && <i className="dot" aria-hidden="true" />}
          <span>{item === null ? t("equipment.empty") : gameName(data, lang, "item", item)}</span>
        </span>
        <span className="where">
          {/* The rarity in words, its colour only reinforcing it. */}
          {rarity !== null && (
            <>
              <span className={`rw${className === "" ? "" : ` ${className}`}`}>{rarityName(data, lang, t, rarity)}</span>
              {" · "}
            </>
          )}
          {where}
        </span>
      </button>
    );
  };

  const close = () => setSlot(null);
  const picking = slot === null ? null : slot;
  return (
    <section className="frame equipment" aria-labelledby="equipment-title">
      <div className="eqhead">
        <h2 id="equipment-title">{t("equipment.title")}</h2>
        <div className="chips" role="group" aria-label={t("equipment.acts")}>
          {ACTS.map((value) => (
            <button key={value} type="button" className="chip" aria-pressed={value === act} onClick={() => setAct(value)}>
              {t("equipment.act", { act: value })}
            </button>
          ))}
        </div>
        <span className="note">{act === "1" ? t(changes === 1 ? "equipment.note.first.one" : "equipment.note.first", { count: changes }) : t(changes === 1 ? "equipment.note.one" : "equipment.note", { count: changes, previous: Number(act) - 1 })}</span>
      </div>
      {actIssues.length > 0 && (
        <ul className="eqnotices" aria-label={t("equipment.notices")}>
          {actIssues.map((issue, i) => (
            <li key={i} className={issue.severity === "invalid" ? "bad" : undefined}>{issueMessage(issue, names)}</li>
          ))}
        </ul>
      )}
      <div className="doll">
        <div className="col">{LEFT.map(card)}</div>
        <div className="figure">
          <Silhouette />
        </div>
        <div className="col">{RIGHT.map(card)}</div>
      </div>
      <h3 className="eyebrow">{t("equipment.weapons")}</h3>
      <div className="slotgrid">{WEAPONS.map(card)}</div>
      <h3 className="eyebrow">{t("equipment.camp")}</h3>
      <div className="slotgrid">{CAMP.map(card)}</div>
      <p className="eqlegend">
        {LEGEND.map((value) => (
          <span key={value} className={`r-${value.replace(" ", "")}`}>
            <i className="dot" aria-hidden="true" />
            <span className="legtext">{rarityName(data, lang, t, value)}</span>
          </span>
        ))}
        <span>{t("equipment.legend.inherited")}</span>
        <span>{t("equipment.legend.warning")}</span>
        <span>{t("equipment.legend.invalid")}</span>
      </p>
      {picking !== null && (
        <ItemPicker
          key={`${act}/${picking}`}
          data={data}
          slotName={slotName(picking)}
          act={act}
          items={options[picking]}
          current={effective[picking].item}
          ownValue={Object.hasOwn(own, picking)}
          onChoose={(item) => {
            onChange(setEquipment(character, act, picking, item));
            close();
          }}
          onEmpty={() => {
            onChange(setEquipment(character, act, picking, null));
            close();
          }}
          onInherit={() => {
            onChange(inheritEquipment(character, act, picking));
            close();
          }}
          onClose={close}
        />
      )}
    </section>
  );
}
