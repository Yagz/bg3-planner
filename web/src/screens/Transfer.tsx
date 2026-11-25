import { useEffect, useRef, useState } from "react";
import type { GameData } from "../../../src/data/types.ts";
import { encode, toReadableJson } from "../../../src/plan/codec.ts";
import { useI18n } from "../i18n/i18n.ts";
import { characterLabel, gameName } from "../names.ts";
import { commitImport, importRun } from "../state/importRun.ts";
import type { ImportResult } from "../state/importRun.ts";
import type { Run } from "../../../src/plan/model.ts";
import type { RunStore } from "../state/storage.ts";

type Props = {
  data: GameData;
  store: RunStore;
  /** The run to export (the app's current run); null when there is none. */
  run: Run | null;
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

function ExportBox({ id, label, value }: { id: string; label: string; value: string }) {
  const { t } = useI18n();
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="field">
      <div className="lab">
        <label htmlFor={id}>{label}</label>
        <button className="btn small" onClick={() => void copy(value, box.current)}>
          {t("transfer.copy")}
        </button>
      </div>
      <textarea id={id} className="box" ref={box} readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
    </div>
  );
}

/** The Import / export screen: the current run as string, readable JSON and link; a paste box that reports before it saves. */
export default function Transfer({ data, store, run, initialText, onImported }: Props) {
  const { t, lang, issueMessage } = useI18n();
  const [exports, setExports] = useState<Exports | null>(null);
  const [text, setText] = useState(initialText ?? "");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const names = (kind: Parameters<typeof gameName>[2], id: string) => gameName(data, lang, kind, id);

  useEffect(() => {
    let live = true;
    setExportError(null);
    if (run === null) {
      setExports(null);
      return;
    }
    encode(run).then(
      (string) => {
        if (live) setExports({ string, json: toReadableJson(run, data.texts[lang]), link: `${window.location.origin}${import.meta.env.BASE_URL}#${string}` });
      },
      (error: unknown) => {
        if (!live) return;
        setExports(null);
        setExportError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
    };
  }, [run, data, lang]);

  const check = async (input: string) => {
    setChecking(true);
    try {
      setResult(await importRun(input, store, data));
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (initialText !== undefined) void check(initialText);
    // Only the text handed over when the screen opens; later pastes go through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialText]);

  const commit = (mode: "replace" | "copy") => {
    if (result === null) return;
    try {
      const saved = commitImport(result, store, mode);
      setResult(null);
      setText("");
      onImported(saved.id);
    } catch (error) {
      setResult({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const conflict = result?.kind === "ready" ? result.conflict : null;

  /** The report's issues by character, in the run's order, each under the character's label (its id when the run has no such character). */
  const issueGroups = (ready: Extract<ImportResult, { kind: "ready" }>) => {
    const order = [...ready.run.characters.map((character) => character.id), ...ready.report.issues.map((issue) => issue.character)];
    return [...new Set(order)]
      .map((id) => {
        const character = ready.run.characters.find((c) => c.id === id);
        const label = character === undefined ? id : characterLabel(data, lang, character.who, t("party.player"));
        return { id, label, issues: ready.report.issues.filter((issue) => issue.character === id) };
      })
      .filter((group) => group.issues.length > 0);
  };

  return (
    <div className="pair">
      <section className="frame exportframe" aria-label={t("transfer.export")}>
      <h2>{t("transfer.export")}</h2>
      {exportError !== null ? (
        <p role="alert" className="banner">
          {t("transfer.exportError", { message: exportError })}
        </p>
      ) : exports === null ? (
        <p className="sub">{t("transfer.noRun")}</p>
      ) : (
        <>
          <ExportBox id="export-string" label={t("transfer.string")} value={exports.string} />
          <ExportBox id="export-link" label={t("transfer.link")} value={exports.link} />
          <ExportBox id="export-json" label={t("transfer.json")} value={exports.json} />
        </>
      )}
      </section>
      <section className="frame importframe" aria-label={t("transfer.import")}>
      <h2>{t("transfer.import")}</h2>
      <div className="field grow">
        <div className="lab">
          <label htmlFor="import-text">{t("transfer.paste")}</label>
          <button className="btn small primary" disabled={checking || text.trim() === ""} onClick={() => void check(text)}>
            {t("transfer.check")}
          </button>
        </div>
        <textarea id="import-text" value={text} onChange={(event) => setText(event.target.value)} />
      </div>
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
            <ul aria-label={t("transfer.issues")} className="bychar">
              {issueGroups(result).map(({ id, label, issues }) => (
                <li key={id}>
                  <h3>{label}</h3>
                  <ul aria-label={label}>
                    {issues.map((issue, index) => (
                      <li key={index} className={issue.severity}>
                        {issue.level === null ? "" : `${t("transfer.level", { level: issue.level })} · `}
                        {issueMessage(issue, names)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {conflict !== null && <p role="alert">{t(`transfer.conflict.${conflict.newer}`, { name: conflict.stored?.name ?? "" })}</p>}
          <div className="runbar">
            {conflict?.newer === "unreadable" ? (
              <button className="btn primary" onClick={() => commit("copy")}>
                {t("transfer.saveNew")}
              </button>
            ) : conflict === null ? (
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
            {(conflict === null || conflict.newer === "unreadable") && (
              <button className="btn" onClick={() => setResult(null)}>
                {t("run.cancel")}
              </button>
            )}
          </div>
        </div>
      )}
      </section>
    </div>
  );
}
