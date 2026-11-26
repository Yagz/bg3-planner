import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/i18n.ts";

type Props = { notes: string; onSave: (notes: string) => void };

/**
 * Free notes on a character: a plain-text field with a local draft. The draft is saved when the field loses focus, when
 * the tab or the character changes (the component unmounts) and when the page is hidden (closing a browser tab fires no
 * blur), and only when it differs from what is stored. Never on a timer: the history keeps a limited number of versions
 * per run and cannot merge them, so a typing session must make one version.
 */
export default function NotesTab({ notes, onSave }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState(notes);
  const latest = useRef({ draft, saved: notes, onSave });
  latest.current.draft = draft;
  latest.current.onSave = onSave;

  const flush = () => {
    const { draft: text, saved, onSave: save } = latest.current;
    if (text === saved) return;
    latest.current.saved = text;
    save(text);
  };

  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return (
    <div className="notes">
      <label htmlFor={id}>{t("character.notes")}</label>
      <textarea id={id} value={draft} rows={14} onChange={(event) => setDraft(event.target.value)} onBlur={flush} />
      <p className="sub">{t("character.notes.help")}</p>
    </div>
  );
}
