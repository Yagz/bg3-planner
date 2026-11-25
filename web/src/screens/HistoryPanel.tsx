import { useMemo, useState } from "react";
import type { TextKind } from "../../../src/data/names.ts";
import type { GameData } from "../../../src/data/types.ts";
import { decodeJson } from "../../../src/plan/codec.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import type { Lang } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import { differsAtAll, runDiff } from "../state/runDiff.ts";
import type { Change } from "../state/runDiff.ts";
import { HISTORY_LIMIT } from "../state/storage.ts";
import type { HistoryEntry } from "../state/storage.ts";

type Props = {
  data: GameData;
  /** The run's shown name. */
  name: string;
  /** Saved versions, newest first; the first one is the current run. */
  versions: HistoryEntry[];
  /** Restores version `at` as the current run (the replaced one stays in the history); throws when the store refuses. */
  onRestore: (at: string) => void;
};

/** A saved version's time in the interface language, to the second (versions can be seconds apart). */
export function versionDate(at: string, lang: Lang): string {
  return new Date(at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

/** One line of a version: who it concerns, what changed, and the value it replaced (shown struck). */
type Line = { who: string; what: string; was?: string };

function readRun(entry: HistoryEntry | undefined): Run | null {
  if (entry === undefined) return null;
  try {
    return decodeJson(entry.text);
  } catch {
    return null;
  }
}

type Described = {
  changes: Change[];
  /** The version differs from the previous one only outside the reported kinds. */ other: boolean;
  /** The previous version could not be read. */ unreadable: boolean;
};

/** The changes of every version against the one saved before it, decoding each version once. The oldest has none. */
function changesOf(versions: HistoryEntry[]): Described[] {
  const runs = versions.map(readRun);
  return versions.map((_, i) => {
    const after = runs[i];
    const before = runs[i + 1];
    if (i === versions.length - 1) return { changes: [], other: false, unreadable: false };
    if (after === null || after === undefined || before === null || before === undefined) return { changes: [], other: false, unreadable: true };
    try {
      const changes = runDiff(before, after);
      return { changes, other: changes.length === 0 && differsAtAll(before, after), unreadable: false };
    } catch {
      return { changes: [], other: false, unreadable: true };
    }
  });
}

/** The recent history of the current run: its saved versions, newest first, each restorable after a confirmation. */
export default function HistoryPanel({ data, name, versions, onRestore }: Props) {
  const { t, lang } = useI18n();
  // `store.history()` returns a fresh array on every call: the memo is keyed on the versions' times, so each is decoded once.
  const key = versions.map((version) => version.at).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const described = useMemo(() => changesOf(versions), [key]);
  const named = (kind: TextKind | null, id: string) => (id === "" ? t("history.none") : gameName(data, lang, kind, id));
  const list = (kind: TextKind | null, ids: string[]) => ids.map((id) => named(kind, id)).join(", ");
  const members = (ids: string[]) => ids.map((id) => characterLabel(data, lang, id, t("party.player"))).join(", ");
  const ruleset = (id: string) =>
    id === "" ? t("history.none") : id === "RULESET_LARIAN" ? gameName(data, lang, "label", "customMode") : gameName(data, lang, "ruleset", id);

  /** The text of one change: its subject, what happened, and the replaced value. */
  const lineOf = (change: Change): Line => {
    const who = change.character === undefined ? t("history.run") : characterLabel(data, lang, change.character, t("party.player"));
    const level = change.level ?? 0;
    const swap = (what: string, kind: TextKind | null): Line => ({
      who,
      what: change.after === undefined ? `${what}${t("history.none")}`.trim() : `${what}${named(kind, change.after)}`.trim(),
      was: change.before === undefined ? undefined : named(kind, change.before),
    });
    switch (change.kind) {
      case "name":
        return {
          who,
          what: t("diff.name"),
          was: change.before === "" ? undefined : change.before,
        };
      case "difficulty":
        return change.after === undefined && change.before === undefined
          ? { who, what: t("diff.difficultyOverrides") }
          : {
              who,
              what: `${t("diff.difficulty")} ${ruleset(change.after ?? "")}`,
              was: ruleset(change.before ?? ""),
            };
      case "progress":
        return change.act === undefined
          ? {
              who,
              what: `${t("diff.level")} ${change.after}`,
              was: change.before,
            }
          : {
              who,
              what: `${t("diff.act")} ${change.after}`,
              was: change.before,
            };
      case "party": {
        const added = change.added ?? [];
        const removed = change.removed ?? [];
        return {
          who: t("diff.party", { act: change.act ?? "" }),
          what: added.length === 0 ? t("history.noOneJoins") : `+ ${members(added)}`,
          was: removed.length === 0 ? undefined : `− ${members(removed)}`,
        };
      }
      case "origin":
        return swap(`${t("diff.origin")} `, "origin");
      case "partySize":
        return { who, what: `${t("diff.partySize")} ${change.after}`, was: change.before };
      case "characterAdded":
        return { who, what: t("diff.characterAdded") };
      case "characterRemoved":
        return { who, what: t("diff.characterRemoved") };
      case "race":
      case "subrace":
        return swap(`${t(`diff.${change.kind}`)} `, "race");
      case "background":
        return swap(`${t("diff.background")} `, "background");
      case "abilities":
        return { who, what: t("diff.abilities"), was: change.before };
      case "levelAdded":
        return { who, what: t("diff.levelAdded", { level }) };
      case "levelRemoved":
        return { who, what: t("diff.levelRemoved", { level }) };
      case "levelClass":
        return swap(`${t("diff.levelClass", { level })} `, "class");
      case "choice":
        if (change.added !== undefined || change.removed !== undefined) {
          const added = change.added ?? [];
          const removed = change.removed ?? [];
          return {
            who,
            what: `${t("diff.choice", { level })} : ${added.length === 0 ? t("history.none") : `+ ${list(null, added)}`}`,
            was: removed.length === 0 ? undefined : `− ${list(null, removed)}`,
          };
        }
        return swap(`${t("diff.choice", { level })} : `, null);
      case "notes":
        return { who, what: t("diff.notes") };
      default:
        return { who, what: t("diff.choiceChanged", { level }) };
    }
  };
  const renderLine = (line: Line, key: number) => (
    <div className="diffline" key={key}>
      <span className="muted">{line.who} :</span> {line.what}
      {line.was !== undefined && (
        <>
          {" "}
          <s className="was">{line.was}</s>
        </>
      )}
    </div>
  );
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = (at: string) => {
    try {
      onRestore(at);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    setAsking(null);
  };

  return (
    <div className="stack">
      <section className="frame history" aria-label={t("history.title", { name })}>
        <h2>{t("history.title", { name })}</h2>
        <p className="sub">{t("history.hint", { count: HISTORY_LIMIT })}</p>
        {error !== null && (
          <p className="banner" role="alert">
            {t("history.error", { message: error })}
          </p>
        )}
        {asking !== null && (
          <div className="confirm">
            <span>
              {t("history.restoreQuestion", {
                date: versionDate(asking, lang),
              })}
            </span>
            <button className="btn primary" onClick={() => restore(asking)}>
              {t("history.restoreConfirm")}
            </button>
            <button className="btn" onClick={() => setAsking(null)}>
              {t("run.cancel")}
            </button>
          </div>
        )}
        <ol aria-label={t("history.versions")}>
          {versions.map((version, index) => {
            const date = versionDate(version.at, lang);
            const info = described[index];
            const lines = (info?.changes ?? []).map(lineOf);
            const rest = lines.slice(2);
            const note = version.note;
            return (
              <li key={version.at}>
                <time dateTime={version.at}>{date}</time>
                <div className="what">
                  {note?.kind === "import" && <span className="note">{t("history.import")}</span>}
                  {note?.kind === "restore" && (
                    <span className="note">
                      {t("history.restored", {
                        date: versionDate(note.from, lang),
                      })}
                    </span>
                  )}
                  {lines.length === 0 && info?.unreadable === true && <span className="note">{t("history.unreadable")}</span>}
                  {lines.length === 0 && info?.unreadable !== true && info?.other === true && <span className="note">{t("history.other")}</span>}
                  {lines.length === 0 && info?.unreadable !== true && info?.other !== true && note === undefined && (
                    <span className="note">{index === versions.length - 1 ? t("history.first") : t("history.nothing")}</span>
                  )}
                  {lines.slice(0, 2).map(renderLine)}
                  {rest.length > 0 && (
                    <details>
                      <summary>{rest.length === 1 ? t("history.moreOne") : t("history.more", { count: rest.length })}</summary>
                      {rest.map(renderLine)}
                    </details>
                  )}
                </div>
                {index === 0 ? (
                  <span className="pill good">{t("history.current")}</span>
                ) : (
                  <button className="btn" aria-label={t("history.restoreLabel", { date })} onClick={() => setAsking(version.at)}>
                    {t("history.restore")}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
