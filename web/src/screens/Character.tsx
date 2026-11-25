import { useMemo, useState } from "react";
import type { TextKind } from "../../../src/data/names.ts";
import type { GameData, Selector } from "../../../src/data/types.ts";
import type { Impact } from "../../../src/engine/impact.ts";
import { resolve } from "../../../src/engine/progression.ts";
import { isOptionalSelector, knownSpellsBefore, levelSlots, validate } from "../../../src/engine/validate.ts";
import { MAX_LEVELS, isOffData } from "../../../src/plan/model.ts";
import type { Character as CharacterModel, Choice, Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import {
  addLevel,
  clearChoice,
  isPreviewedSlot,
  previewNeeded,
  removeLastLevel,
  replaceCharacter,
  setAbilities,
  setChoice,
  setIdentity,
  setLevelClass,
} from "../state/characterOps.ts";
import ChoicePicker, { kindOfList } from "./character/ChoicePicker.tsx";
import type { PickerMode, PickerSpec } from "./character/ChoicePicker.tsx";
import Creation from "./character/Creation.tsx";
import type { IdentityField } from "./character/Creation.tsx";
import LevelList, { CLASS_SLOT } from "./character/LevelList.tsx";

type Props = {
  data: GameData;
  /** The current run, owned by the app shell. */
  run: Run;
  /** Saves a new version of the run; throws when the store refuses. */
  saveRun: (run: Run) => void;
  /** The character shown; null for the run's first one. */
  characterId: string | null;
  onSelect: (id: string) => void;
};

/** What the picker is open on: an identity field, or a slot of a level (`class` for the class taken). */
type Target = { field: IdentityField } | { level: number; slot: string };

/** A picker's spec with what saving and clearing do to the character. */
type Opened = { spec: PickerSpec; save: (choice: Choice) => CharacterModel; clear: () => CharacterModel; previewed: boolean };

function modeOf(selector: Selector): PickerMode {
  switch (selector.function) {
    case "SelectAbilityBonus":
      return { type: "bonus", bonuses: selector.bonuses };
    case "SelectAbilities":
      return { type: "increments", count: selector.count, max: selector.max };
    case "ReplacePassives":
      return { type: "set", min: 0, max: selector.count };
    case "AddSpells":
      return { type: "set", min: 0, max: 0 };
    default:
      return { type: "set", min: selector.count, max: selector.count };
  }
}

/** A single value (identity, class) from a picker's choice: its one entry, or the value outside the game data. */
function single(choice: Choice): string | { offData: string } {
  if (isOffData(choice)) return choice;
  return Array.isArray(choice) ? (choice[0] ?? "") : "";
}

/** The character editor: creation block, levels 1 to 12 as a list, and the game's list for each choice. */
export default function Character({ data, run, saveRun, characterId, onSelect }: Props) {
  const { t, lang } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  const character = characterId === null ? run.characters[0] : run.characters.find((c) => c.id === characterId);
  const issues = useMemo(() => (character === undefined ? [] : validate({ ...run, characters: [character] }, data).issues), [run, character, data]);

  if (character === undefined) return <p className="sub">{t(run.characters.length === 0 ? "character.none" : "character.unknown")}</p>;

  const label = (c: CharacterModel) => characterLabel(data, lang, c.who, t("party.player"));
  const originName = character.who === "player" ? run.origin : character.who;
  // The same origin `addCharacter` takes the fixed fields from.
  const locked = Object.hasOwn(data.rules.origins, originName) && data.rules.origins[originName]!.lockRace;
  const { race } = character;
  const subraces = isOffData(race) ? [] : Object.keys(data.rules.races).filter((name) => data.rules.races[name]!.parent === race);
  const sortByName = (ids: string[], kind: TextKind) => [...ids].sort((a, b) => gameName(data, lang, kind, a).localeCompare(gameName(data, lang, kind, b), lang));

  const save = (after: CharacterModel) => saveRun(replaceCharacter(run, after));
  /**
   * Hook point of the impact preview: Task 8 replaces it with the preview dialog, whose Apply saves `preview.result`.
   * Until then the change applies as made: no pick is removed, and the engine flags those left under slots that no longer exist.
   */
  const applyAfterPreview = (_preview: Impact, after: CharacterModel) => save(after);
  /** Saves a change; one that may alter what the game grants goes through the impact preview when it does. */
  const commit = (after: CharacterModel, previewed: boolean) => {
    try {
      const preview = previewed ? previewNeeded(character, after, run, data) : null;
      if (preview === null) save(after);
      else applyAfterPreview(preview, after);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const open = (current: Target): Opened | null => {
    if ("field" in current) {
      const { field } = current;
      const items =
        field === "race"
          ? sortByName(Object.keys(data.rules.races).filter((name) => data.rules.races[name]!.parent === null), "race")
          : field === "subrace"
            ? sortByName(subraces, "race")
            : // Backgrounds the game hides at character creation are offered only when already chosen.
              sortByName(Object.keys(data.rules.backgrounds).filter((id) => !data.rules.backgrounds[id]!.origin), "background");
      const value = character[field];
      const initial: Choice | undefined = isOffData(value) ? value : value === null || value === "" ? undefined : [value];
      return {
        spec: { title: t(`character.${field}`), items, kind: field === "background" ? "background" : "race", mode: { type: "single" }, initial },
        save: (choice) => setIdentity(character, field, single(choice)),
        clear: () => setIdentity(character, field, field === "subrace" ? null : ""),
        previewed: true,
      };
    }
    const { level: n, slot } = current;
    const resolved = resolve(character, data).levels[n - 1];
    const entry = character.levels[n - 1];
    if (resolved === undefined || entry === undefined) return null;
    const where = t("character.level", { level: n });
    const initial = Object.hasOwn(entry.choices, slot) ? entry.choices[slot] : undefined;
    if (slot === CLASS_SLOT) {
      const items = sortByName(Object.keys(data.rules.classes).filter((name) => data.rules.classes[name]!.parent === null), "class");
      return {
        spec: { title: `${t("character.class")} · ${where}`, items, kind: "class", mode: { type: "single" }, initial: isOffData(entry.class) ? entry.class : entry.class === "" ? undefined : [entry.class] },
        save: (choice) => setLevelClass(character, n, single(choice)),
        clear: () => setLevelClass(character, n, ""),
        previewed: true,
      };
    }
    const heading = (what: string) => `${what} · ${where} (${resolved.class === "" ? "?" : gameName(data, lang, "class", resolved.class)} ${resolved.classLevel})`;
    const base = { save: (choice: Choice) => setChoice(character, n, slot, choice), clear: () => clearChoice(character, n, slot), previewed: isPreviewedSlot(slot) };
    if (slot.startsWith("subclass:")) {
      return { ...base, spec: { title: heading(t("choice.subclass")), items: resolved.subclassChoice ?? [], kind: "class", mode: { type: "single" }, initial } };
    }
    const slots = levelSlots(resolved, entry.choices, data);
    if (slots.feat !== null && slot === slots.feat.id) {
      return { ...base, spec: { title: heading(t("choice.feat")), items: sortByName(Object.keys(data.rules.feats), "feat"), kind: "feat", mode: { type: "single" }, initial } };
    }
    const found = [...slots.selectors, ...(slots.feat?.selectors ?? [])].find((s) => s.id === slot);
    if (found === undefined) return null;
    const { selector, scope } = found;
    const spec: PickerSpec = {
      title: heading(t(`choice.${selector.function}`)),
      items: Object.hasOwn(data.rules.lists, selector.list) ? data.rules.lists[selector.list]!.items : [],
      kind: kindOfList(data, selector.list),
      mode: modeOf(selector),
      initial,
    };
    if (selector.function === "SelectSpells" && selector.swaps > 0) spec.swaps = { max: selector.swaps, known: knownSpellsBefore(character, data, n, scope) };
    return {
      ...base,
      spec,
      // An optional slot left empty keeps nothing stored, as if never opened.
      save: (choice) => (Array.isArray(choice) && choice.length === 0 && isOptionalSelector(selector) ? clearChoice(character, n, slot) : setChoice(character, n, slot, choice)),
    };
  };

  const opened = target === null ? null : open(target);
  const close = () => setTarget(null);
  const undecided = issues.filter((issue) => issue.severity === "incomplete").length;
  const classes = new Map<string, number>();
  for (const entry of character.levels) if (!isOffData(entry.class) && entry.class !== "") classes.set(entry.class, (classes.get(entry.class) ?? 0) + 1);
  const meta = [
    isOffData(race) ? race.offData : race === "" ? null : gameName(data, lang, "race", race),
    [...classes].map(([cls, count]) => `${gameName(data, lang, "class", cls)} ${count}`).join(" / ") || null,
  ].filter((part) => part !== null);

  return (
    <div className="character">
      {run.characters.length > 1 && (
        <div className="chips" role="group" aria-label={t("character.choose")}>
          {run.characters.map((c) => (
            <button key={c.id} className="chip" aria-pressed={c.id === character.id} onClick={() => onSelect(c.id)}>
              {label(c)}
            </button>
          ))}
        </div>
      )}
      <div className="charhead">
        <h1>{label(character)}</h1>
        {meta.length > 0 && <span className="meta">{meta.join(" · ")}</span>}
        <span className={`pill ${undecided === 0 ? "good" : "todo"}`}>{undecided === 0 ? t("character.complete") : t("character.undecided", { count: undecided })}</span>
      </div>
      {error !== null && (
        <p className="banner" role="alert">
          {t("character.error", { message: error })}
        </p>
      )}
      <Creation
        data={data}
        character={character}
        issues={issues.filter((issue) => issue.level === null)}
        locked={locked}
        hasSubraces={subraces.length > 0 || isOffData(race)}
        onPick={(field) => setTarget({ field })}
        onAbility={(ability, value) => commit(setAbilities(character, { ...character.abilities, [ability]: value }), false)}
      />
      <LevelList
        data={data}
        character={character}
        issues={issues.filter((issue) => issue.level !== null)}
        progressLevel={run.progress.level}
        onPick={(level, slot) => setTarget({ level, slot })}
      />
      <div className="row levelactions">
        <button className="btn" disabled={character.levels.length >= MAX_LEVELS} onClick={() => commit(addLevel(character), true)}>
          {t("character.addLevel")}
        </button>
        <button className="btn" disabled={character.levels.length <= 1} onClick={() => commit(removeLastLevel(character), true)}>
          {t("character.removeLevel", { level: character.levels.length })}
        </button>
      </div>
      {opened !== null && (
        <ChoicePicker
          key={JSON.stringify(target)}
          data={data}
          spec={opened.spec}
          onSave={(choice) => {
            commit(opened.save(choice), opened.previewed);
            close();
          }}
          onClear={() => {
            commit(opened.clear(), opened.previewed);
            close();
          }}
          onClose={close}
        />
      )}
    </div>
  );
}
