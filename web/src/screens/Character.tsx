import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { TextKind } from "../../../src/data/names.ts";
import type { GameData, Selector } from "../../../src/data/types.ts";
import type { Impact } from "../../../src/engine/impact.ts";
import { identityTraits } from "../../../src/engine/traits.ts";
import { castingAbility } from "../../../src/engine/casting.ts";
import { rulesetEffects } from "../../../src/engine/difficulty.ts";
import { resolve } from "../../../src/engine/progression.ts";
import { isOptionalSelector, knownSpellsBefore, levelSlots, validate } from "../../../src/engine/validate.ts";
import { MAX_LEVELS, isOffData } from "../../../src/plan/model.ts";
import type { Character as CharacterModel, Choice, Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import {
  addLevel,
  clearChoice,
  previewNeeded,
  removeLastLevel,
  replaceCharacter,
  setAbilities,
  setChoice,
  setIdentity,
  setLevelClass,
  setNotes,
  withOriginLock,
} from "../state/characterOps.ts";
import ChoicePicker, { kindOfList } from "./character/ChoicePicker.tsx";
import type { PickerMode, PickerSpec } from "./character/ChoicePicker.tsx";
import Abilities from "./character/Abilities.tsx";
import Creation from "./character/Creation.tsx";
import type { IdentityField } from "./character/Creation.tsx";
import { traitNames } from "./character/Traits.tsx";
import ImpactPreview from "./character/ImpactPreview.tsx";
import LevelList, { CLASS_SLOT } from "./character/LevelList.tsx";
import LevelTree from "./character/LevelTree.tsx";
import NotesTab from "./character/NotesTab.tsx";
import Sidebar from "./character/Sidebar.tsx";
import { classLineText } from "./party/MemberCard.tsx";
import { loadTab, saveTab } from "../state/sessionTab.ts";
import type { CharacterTab } from "../state/sessionTab.ts";

type Props = {
  data: GameData;
  /** The current run, owned by the app shell. */
  run: Run;
  /** Saves a new version of the run; throws when the store refuses. */
  saveRun: (run: Run) => void;
  /** The character shown; null for the run's first one. */
  characterId: string | null;
  onSelect: (id: string) => void;
  /** Levels shown as a tree rather than a list (remembered in the settings). */
  tree: boolean;
  onTree: (tree: boolean) => void;
  /** Where the open tab of each character is remembered for the session; null when unavailable. */
  sessionBackend: Storage | null;
};

/** What the picker is open on: an identity field, or a slot of a level (`class` for the class taken). */
type Target = { field: IdentityField } | { level: number; slot: string };

/** A picker's spec with what saving and clearing do to the character. */
type Opened = { spec: PickerSpec; save: (choice: Choice) => CharacterModel; clear: () => CharacterModel };

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

/** The character editor: summary of what the character brings, creation block, levels 1 to 12 as a list or a tree, the game's list for each choice, and the impact preview of a change. */
export default function Character({ data, run, saveRun, characterId, onSelect, tree, onTree, sessionBackend }: Props) {
  const { t, lang } = useI18n();
  const [target, setTarget] = useState<Target | null>(null);
  /** Tabs chosen on this screen; a character not in it opens on the tab remembered for the session. */
  const [chosenTabs, setChosenTabs] = useState<Record<string, CharacterTab>>({});
  /** The level each character is seen at in the sidebar; absent means its last planned level. */
  const [viewedLevels, setViewedLevels] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  /** A change waiting in the impact preview, with the character it replaces and, for a change of origin, the run's new origin. */
  const [pending, setPending] = useState<{ before: CharacterModel; impact: Impact; origin?: string } | null>(null);
  const character = characterId === null ? run.characters[0] : run.characters.find((c) => c.id === characterId);
  const issues = useMemo(() => (character === undefined ? [] : validate({ ...run, characters: [character] }, data).issues), [run, character, data]);

  if (character === undefined) return <p className="sub">{t(run.characters.length === 0 ? "character.none" : "character.unknown")}</p>;

  const tab = chosenTabs[character.id] ?? loadTab(sessionBackend, character.id);
  const chooseTab = (next: CharacterTab) => {
    saveTab(sessionBackend, character.id, next);
    setChosenTabs((tabs) => ({ ...tabs, [character.id]: next }));
  };
  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const names = ["sheet", "notes"] as const;
    const at = names.indexOf(tab);
    const target = { ArrowRight: (at + 1) % names.length, ArrowLeft: (at + names.length - 1) % names.length, Home: 0, End: names.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    chooseTab(names[target]!);
    document.getElementById(`chartab-${names[target]}`)?.focus();
  };
  const label = (c: CharacterModel) => characterLabel(data, lang, c.who, t("party.player"));
  const originName = character.who === "player" ? run.origin : character.who;
  // The same origin `addCharacter` takes the fixed fields from.
  const origin = Object.hasOwn(data.rules.origins, originName) ? data.rules.origins[originName] : undefined;
  const locked = origin?.lockRace === true;
  const originBackground = origin?.background ?? null;
  const { race } = character;
  const subraces = isOffData(race) ? [] : Object.keys(data.rules.races).filter((name) => data.rules.races[name]!.parent === race);
  const sortByName = (ids: string[], kind: TextKind) => [...ids].sort((a, b) => gameName(data, lang, kind, a).localeCompare(gameName(data, lang, kind, b), lang));

  /** Runs a change, showing its failure in the banner; says whether it went through. */
  const attempt = (change: () => void): boolean => {
    try {
      change();
      setError(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    }
  };
  const save = (after: CharacterModel, origin?: string) => saveRun({ ...replaceCharacter(run, after), ...(origin === undefined ? {} : { origin }) });
  /**
   * Saves a change, or opens the impact preview when the engine reports a feature gained or lost, a pick removed, or a
   * later choice made impossible; applying the preview saves its result (the removed picks dropped, nothing else).
   */
  const commit = (after: CharacterModel, origin?: string) =>
    attempt(() => {
      const preview = previewNeeded(character, after, run, data);
      if (preview === null) save(after, origin);
      else setPending({ before: character, impact: preview, ...(origin === undefined ? {} : { origin }) });
    });
  const apply = () => {
    if (pending === null) return;
    const { impact: { result }, origin } = pending;
    setPending(null);
    attempt(() => save(result, origin));
  };
  // The player's origin: the custom player, or an origin the game offers at character creation that is not already a
  // companion in the run (the current one stays listed).
  const originOptions = sortByName(
    Object.keys(data.rules.origins).filter(
      (name) => name === run.origin || (name !== "Generic" && data.rules.origins[name]!.playable && !run.characters.some((c) => c.who === name)),
    ),
    "origin",
  );
  const changeOrigin = (next: string) => commit(withOriginLock(character, data, next), next);

  const open = (current: Target): Opened | null => {
    if ("field" in current) {
      const { field } = current;
      const items =
        field === "race"
          ? sortByName(Object.keys(data.rules.races).filter((name) => data.rules.races[name]!.parent === null), "race")
          : field === "subrace"
            ? sortByName(subraces, "race")
            : // Backgrounds the game hides at character creation are offered only to their origin, or when already chosen.
              sortByName(Object.keys(data.rules.backgrounds).filter((id) => !data.rules.backgrounds[id]!.origin || id === originBackground), "background");
      const value = character[field];
      const initial: Choice | undefined = isOffData(value) ? value : value === null || value === "" ? undefined : [value];
      // Race and subrace entries list what they give; a race also names its subraces.
      const details: Record<string, string[]> = {};
      if (field !== "background") {
        for (const name of items) {
          const own = traitNames(data, lang, t, identityTraits(data, name));
          const children = field === "race" ? sortByName(Object.keys(data.rules.races).filter((other) => data.rules.races[other]!.parent === name), "race") : [];
          details[name] = children.length === 0 ? own : [...own, t("trait.subraces", { names: children.map((child) => gameName(data, lang, "race", child)).join(", ") })];
        }
      }
      return {
        spec: { title: t(`character.${field}`), items, kind: field === "background" ? "background" : "race", mode: { type: "single" }, ...(field === "background" ? {} : { details }), initial },
        save: (choice) => setIdentity(character, field, single(choice)),
        clear: () => setIdentity(character, field, field === "subrace" ? null : ""),
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
      };
    }
    const heading = (what: string) => `${what} · ${where} (${resolved.class === "" ? "?" : gameName(data, lang, "class", resolved.class)} ${resolved.classLevel})`;
    const base = { save: (choice: Choice) => setChoice(character, n, slot, choice), clear: () => clearChoice(character, n, slot) };
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
    if (selector.function === "SelectSpells") {
      spec.spells = { ability: castingAbility(resolved, found, data) };
      if (selector.swaps > 0) spec.swaps = { max: selector.swaps, known: knownSpellsBefore(character, data, n, scope) };
    }
    return {
      ...base,
      spec,
      // An optional slot left empty keeps nothing stored, as if never opened.
      save: (choice) => (Array.isArray(choice) && choice.length === 0 && isOptionalSelector(selector) ? clearChoice(character, n, slot) : setChoice(character, n, slot, choice)),
    };
  };

  const opened = target === null ? null : open(target);
  const close = () => setTarget(null);
  const { multiclass } = rulesetEffects(run.difficulty, data);
  const raceName = (value: string | { offData: string } | null) => (value === null || value === "" ? "" : isOffData(value) ? value.offData : gameName(data, lang, "race", value));
  const identity = raceName(character.subrace === null || character.subrace === "" ? character.race : character.subrace);
  const levelIssues = issues.filter((issue) => issue.level !== null);

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
      {error !== null && (
        <p className="banner" role="alert">
          {t("character.error", { message: error })}
        </p>
      )}
      <header className="charhead">
        <h1>{label(character)}</h1>
        <p className="sub">{[identity, classLineText(character, run.progress.level, data, lang)].filter((part) => part !== "").join(" · ")}</p>
      </header>
      <div className="charlayout">
        <aside className="charside" aria-label={t("character.summary")}>
          <Sidebar
            character={character}
            run={run}
            data={data}
            viewed={viewedLevels[character.id] ?? character.levels.length}
            onViewed={(level) =>
              setViewedLevels((levels) => {
                const { [character.id]: _dropped, ...rest } = levels;
                return level >= character.levels.length ? rest : { ...rest, [character.id]: level };
              })
            }
          />
        </aside>
        <div className="charmain">
          <div className="tabs" role="tablist" aria-label={t("character.tabs")} onKeyDown={onTabKey}>
            {(["sheet", "notes"] as const).map((name) => (
              <button key={name} type="button" role="tab" id={`chartab-${name}`} aria-selected={tab === name} aria-controls={`charpanel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => chooseTab(name)}>
                {t(`character.tab.${name}`)}
              </button>
            ))}
          </div>
          <div className="stack" role="tabpanel" id="charpanel-sheet" aria-labelledby="chartab-sheet" hidden={tab !== "sheet"}>
            <Creation
              data={data}
              character={character}
              issues={issues.filter((issue) => issue.level === null)}
              locked={locked}
              hasSubraces={subraces.length > 0}
              onPick={(field) => setTarget({ field })}
              origin={character.who === "player" ? { value: run.origin, options: originOptions, onChange: changeOrigin } : undefined}
            />
            <Abilities
              key={character.id}
              data={data}
              character={character}
              issues={issues}
              onBase={(ability, value) => commit(setAbilities(character, { ...character.abilities, [ability]: value }))}
              onBonus={(slot, choice) => commit(setChoice(character, 1, slot, choice))}
            />
            <section className="frame levelsframe" aria-labelledby="levels-title">
              <div className="framehead">
                <div>
                  <h2 id="levels-title">{t("character.levels")}</h2>
                  <p className="sub">{t("character.levels.help")}</p>
                </div>
                <label className="switch">
                  <input type="checkbox" checked={tree} onChange={(event) => onTree(event.target.checked)} /> {t("character.tree")}
                </label>
              </div>
              {tree ? (
                <LevelTree
                  data={data}
                  character={character}
                  issues={levelIssues}
                  progressLevel={run.progress.level}
                  multiclass={multiclass}
                  onPick={(level, slot) => setTarget({ level, slot })}
                  onChoose={(level, slot, choice) => commit(setChoice(character, level, slot, choice))}
                />
              ) : (
                <LevelList data={data} character={character} issues={levelIssues} progressLevel={run.progress.level} multiclass={multiclass} onPick={(level, slot) => setTarget({ level, slot })} />
              )}
              <div className="row levelactions">
                <button className="btn" disabled={character.levels.length >= MAX_LEVELS} onClick={() => commit(addLevel(character))}>
                  {t("character.addLevel")}
                </button>
                <button className="btn" disabled={character.levels.length <= 1} onClick={() => commit(removeLastLevel(character))}>
                  {t("character.removeLevel", { level: character.levels.length })}
                </button>
              </div>
            </section>
          </div>
          <div role="tabpanel" id="charpanel-notes" aria-labelledby="chartab-notes" hidden={tab !== "notes"}>
            {tab === "notes" && <NotesTab key={character.id} notes={character.notes} onSave={(notes) => attempt(() => save(setNotes(character, notes)))} />}
          </div>
        </div>
      </div>
      {opened !== null && (
        <ChoicePicker
          key={JSON.stringify(target)}
          data={data}
          spec={opened.spec}
          onSave={(choice) => {
            commit(opened.save(choice));
            close();
          }}
          onClear={() => {
            commit(opened.clear());
            close();
          }}
          onClose={close}
        />
      )}
      {pending !== null && <ImpactPreview data={data} before={pending.before} impact={pending.impact} onApply={apply} onCancel={() => setPending(null)} />}
    </div>
  );
}
