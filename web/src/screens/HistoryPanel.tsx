import { useState } from "react";
import { useI18n } from "../i18n/i18n.ts";
import type { Lang } from "../i18n/i18n.ts";
import { HISTORY_LIMIT } from "../state/storage.ts";
import type { HistoryEntry } from "../state/storage.ts";

type Props = {
  /** The run's shown name. */
  name: string;
  /** Saved versions, newest first; the first one is the current run. */
  versions: HistoryEntry[];
  /** Restores version `at` as the current run (the replaced one stays in the history); throws when the store refuses. */
  onRestore: (at: string) => void;
};

/** A saved version's time in the interface language, to the second (versions can be seconds apart). */
export function versionDate(at: string, lang: Lang): string {
  return new Date(at).toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "medium" });
}

/** The recent history of the current run: its saved versions, newest first, each restorable after a confirmation. */
export default function HistoryPanel({ name, versions, onRestore }: Props) {
  const { t, lang } = useI18n();
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
          <span>{t("history.restoreQuestion", { date: versionDate(asking, lang) })}</span>
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
          return (
            <li key={version.at}>
              <time dateTime={version.at}>{date}</time>{" "}
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
  );
}
