import type { GameData } from "../../../../src/data/types.ts";
import type { Trait } from "../../../../src/engine/traits.ts";
import { useI18n } from "../../i18n/i18n.ts";
import type { Lang, Translate } from "../../i18n/i18n.ts";
import { gameDescription, gameName } from "../../names.ts";

/** One trait as display parts: its level prefix, the lead text (the passive's name is shown in bold), and its description. */
type Line = { level: number; lead: string; bold: boolean; description: string | null };

const capitalized = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/** A decimal number in the language's convention ("1,5" in French). */
const decimal = (lang: Lang, value: number) => String(value).replace(".", lang === "fr" ? "," : ".");

/** The lines of a trait list; a trait the interface does not show (an unrecognised boost, a resource counter) gives none. */
function lines(data: GameData, lang: Lang, t: Translate, traits: Trait[], descriptions: boolean): Line[] {
  const result: Line[] = [];
  const ability = (name: string) => gameName(data, lang, "ability", name);
  for (const trait of traits) {
    const { level } = trait;
    const plain = (lead: string): Line => ({ level, lead, bold: false, description: null });
    switch (trait.kind) {
      case "passive":
        result.push({ level, lead: gameName(data, lang, "passive", trait.id), bold: true, description: descriptions ? gameDescription(data, lang, "passive", trait.id) : null });
        break;
      case "skill":
        result.push(plain(t("trait.proficiency", { skill: gameName(data, lang, "skill", trait.skill) })));
        break;
      case "speed":
        result.push(plain(t(trait.added ? "trait.speedAdded" : "trait.speed", { meters: decimal(lang, trait.meters) })));
        break;
      case "hpPerLevel":
        result.push(plain(t("trait.hpPerLevel")));
        break;
      case "spells": {
        const spells = trait.spells.map((id) => gameName(data, lang, "spell", id)).join(", ");
        result.push(plain(trait.ability === null ? spells : t(trait.spells.length > 1 ? "trait.spellsCastMany" : "trait.spellsCast", { spells, ability: ability(trait.ability) })));
        break;
      }
      case "choice": {
        const items = Object.hasOwn(data.rules.lists, trait.list) ? (data.rules.lists[trait.list]?.items ?? []) : [];
        // A spell choice offering only cantrips is named as such.
        const cantrips = trait.function === "SelectSpells" && items.length > 0 && items.every((id) => Object.hasOwn(data.rules.spells, id) && data.rules.spells[id]?.level === 0);
        const what = cantrips ? t("spell.cantrip") : capitalized(t(`choice.${trait.function}`));
        result.push(plain(trait.ability === null ? t("trait.choice", { what, count: trait.count }) : t("trait.choiceCast", { what, count: trait.count, ability: ability(trait.ability) })));
        break;
      }
      case "resource":
      case "unknownBoost":
        break;
    }
  }
  return result;
}

/** The traits as plain text lines without descriptions, for the pickers. */
export function traitNames(data: GameData, lang: Lang, t: Translate, traits: Trait[]): string[] {
  return lines(data, lang, t, traits, false).map((line) => (line.level > 1 ? `${t("trait.atLevel", { level: line.level })} ${line.lead}` : line.lead));
}

/** What a race, a subrace or a background gives: one item per trait, those above level 1 prefixed with their level. */
export function TraitList({ data, traits, descriptions }: { data: GameData; traits: Trait[]; descriptions: boolean }) {
  const { t, lang } = useI18n();
  const shown = lines(data, lang, t, traits, descriptions);
  if (shown.length === 0) return <p className="trait sub">{t("character.noTraits")}</p>;
  return (
    <ul className="traits">
      {shown.map((line, i) => (
        <li key={i} className="trait">
          {line.level > 1 && `${t("trait.atLevel", { level: line.level })} `}
          {line.bold ? <b>{line.lead}</b> : line.lead}
          {line.description !== null && <span className="d">{line.description}</span>}
        </li>
      ))}
    </ul>
  );
}
