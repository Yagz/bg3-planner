import { useEffect, useRef, useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { encode, toReadableJson } from "../../../src/plan/codec.ts";
import { useI18n } from "../i18n/i18n.ts";
import { gameName } from "../names.ts";
import { commitImport, importRun } from "../state/importRun.ts";
import type { ImportResult } from "../state/importRun.ts";
import type { RunStore } from "../state/storage.ts";

type Props = {
  data: GameData;
  store: RunStore;
  /** The run to export; null when there is none. */
  runId: string | null;
  /** A run string or link to import as soon as the screen opens (a link opened in the browser). */
  initialText?: string;
  /** Called with the id of the run an import saved. */
  onImported: (id: string) => void;
};

type Exports = { string: string; json: string; link: string };

/** Copies `text` to the clipboard; where the browser refuses, selects the box so the user can copy it by hand. */
async function copy(text: string, box: HTMLTextAreaElement | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    box?.focus();
    box?.select();
  }
}

function ExportBox({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <section className="xbox">
      <label>
        <span className="sub">{label}</span>
        <textarea ref={box} readOnly rows={3} value={value} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button className="btn" onClick={() => void copy(value, box.current)}>
        {t("transfer.copy")}
      </button>
    </section>
  );
}

/** The Import / export screen: the current run as string, readable JSON and link; a paste box that reports before it saves. */
export default function Transfer({ data, store, runId, initialText, onImported }: Props) {
  const { t, lang, issueMessage } = useI18n();
  const [exports, setExports] = useState<Exports | null>(null);
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [checking, setChecking] = useState(false);
  const names = (kind: Parameters<typeof gameName>[2], id: string) => gameName(data, lang, kind, id);

  useEffect(() => {
    let live = true;
    const run = runId === null ? null : store.load(runId);
    if (run === null) {
      setExports(null);
      return;
    }
    encode(run).then(
      (string) => {
        if (live) setExports({ string, json: toReadableJson(run, data.texts[lang]), link: `${window.location.origin}${import.meta.env.BASE_URL}#${string}` });
      },
      () => {
        if (live) setExports(null);
      },
    );
    return () => {
      live = false;
    };
  }, [runId, store, data, lang]);

  const check = async (input: string) => {
    setChecking(true);
    setResult(await importRun(input, store, data));
    setChecking(false);
  };

  useEffect(() => {
    if (initialText !== undefined) void check(initialText);
    // Only the text handed over when the screen opens; later pastes go through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  const commit = (mode: "replace" | "copy") => {
    if (result === null) return;
    const saved = commitImport(result, store, mode);
    setResult(null);
    setText("");
    onImported(saved.id);
  };

  const conflict = result?.kind === "ready" ? result.conflict : null;

  return (
    <div className="transfer">
      <h2>{t("transfer.export")}</h2>
      {exports === null ? (
        <p className="sub">{t("transfer.noRun")}</p>
      ) : (
        <>
          <ExportBox label={t("transfer.string")} value={exports.string} />
          <ExportBox label={t("transfer.link")} value={exports.link} />
          <ExportBox label={t("transfer.json")} value={exports.json} />
        </>
      )}
      <h2>{t("transfer.import")}</h2>
      <label>
        <span className="sub">{t("transfer.paste")}</span>
        <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <button className="btn primary" disabled={checking || text.trim() === ""} onClick={() => void check(text)}>
        {t("transfer.check")}
      </button>
      {result?.kind === "error" && (
        <p role="alert" className="banner">
          {t("transfer.error", { message: result.message })}
        </p>
      )}
      {result?.kind === "ready" && (
        <div className="report">
          <p>
            <strong>{result.run.name === "" ? t("run.untitled") : result.run.name}</strong> — {t(`transfer.status.${result.report.status}`)}
          </p>
          {result.warnings.length > 0 && (
            <ul aria-label={t("transfer.warnings")}>
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          )}
          {result.report.issues.length > 0 && (
            <ul aria-label={t("transfer.issues")}>
              {result.report.issues.map((issue, index) => (
                <li key={index} className={issue.severity}>
                  {issue.level === null ? "" : `${t("transfer.level", { level: issue.level })} · `}
                  {issueMessage(issue, names)}
                </li>
              ))}
            </ul>
          )}
          {conflict !== null && <p role="alert">{t(`transfer.conflict.${conflict.newer}`, { name: conflict.stored.name })}</p>}
          <div className="runbar">
            {conflict === null ? (
              <button className="btn primary" onClick={() => commit("replace")}>
                {t("transfer.import.confirm")}
              </button>
            ) : (
              <>
                <button className="btn primary" onClick={() => setResult(null)}>
                  {t("transfer.keep")}
                </button>
                <button className="btn" onClick={() => commit("replace")}>
                  {t("transfer.replace")}
                </button>
                <button className="btn" onClick={() => commit("copy")}>
                  {t("transfer.copyRun")}
                </button>
              </>
            )}
            {conflict === null && (
              <button className="btn" onClick={() => setResult(null)}>
                {t("run.cancel")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
