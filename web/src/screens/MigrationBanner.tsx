import { useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import type { Run } from "../../../src/plan/model.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import type { MigrationReport } from "../state/storage.ts";

/** Where the save time of the stored version whose banner was closed is remembered, per run. */
export const DISMISS_PREFIX = "bg3p:migrated:";

function dismissedAt(storage: Storage | null, id: string): string | null {
  try {
    return storage?.getItem(DISMISS_PREFIX + id) ?? null;
  } catch {
    return null;
  }
}

type Props = {
  data: GameData;
  /** The run's id in the store, which keys the dismissal. */
  runId: string;
  /** The run as read, migrated to the current format. */
  run: Run;
  /** What the migration of its current stored version reported. */
  report: MigrationReport;
  /** Where the dismissal is remembered (normally `localStorage`); null, or a refusing storage, shows the banner again next time. */
  storage: Storage | null;
};

/**
 * Names the items a run stored in an older format could not place when read (each is kept in its character's notes), until
 * closed for that stored version; once the run is saved in the current format nothing migrates and the banner is gone.
 */
export default function MigrationBanner({ data, runId, run, report, storage }: Props) {
  const { t, lang } = useI18n();
  const [closed, setClosed] = useState(() => dismissedAt(storage, runId) === report.at);
  if (closed || report.unplaced.length === 0) return null;

  const close = () => {
    try {
      storage?.setItem(DISMISS_PREFIX + runId, report.at);
    } catch {
      // A storage that refuses only means the banner shows again on the next visit.
    }
    setClosed(true);
  };
  const who = (id: string) => {
    const character = run.characters.find((candidate) => candidate.id === id);
    return character === undefined ? id : characterLabel(data, lang, character.who, t("party.player"));
  };
  const count = report.unplaced.length;

  return (
    <div className="banner wrap migrated" role="status">
      <p>
        <span className="sign" aria-hidden="true">
          ⚠
        </span>{" "}
        {t(count === 1 ? "migration.banner" : "migration.banner.many", { version: report.fromVersion, count })}
      </p>
      <ul>
        {report.unplaced.map((entry, index) => (
          <li key={index}>{t("migration.item", { character: who(entry.character), item: gameName(data, lang, "item", entry.item), reason: t(`migration.reason.${entry.reason}`) })}</li>
        ))}
      </ul>
      <button type="button" className="btn" onClick={close}>
        {t("migration.close")}
      </button>
    </div>
  );
}
