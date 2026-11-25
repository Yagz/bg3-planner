import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GameData } from "../../src/data/types.ts";
import { I18nContext, LANGS, createI18n } from "./i18n/i18n.ts";
import Party from "./screens/Party.tsx";
import Transfer from "./screens/Transfer.tsx";
import type { Lang } from "./i18n/i18n.ts";
import { createRun, currentRunId, deleteRun, duplicateRun, renameRun } from "./state/runs.ts";
import { loadSettings, saveSettings } from "./state/settings.ts";
import type { Settings, Theme } from "./state/settings.ts";
import type { RunStore } from "./state/storage.ts";

type Route = { screen: "party" } | { screen: "character"; id: string | null } | { screen: "transfer" };

const THEMES: Theme[] = ["system", "light", "dark"];

/** Percent-decoding that keeps a malformed fragment as written instead of throwing. */
function decodeFragment(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function parseRoute(hash: string): Route {
  if (hash === "#/transfer") return { screen: "transfer" };
  const character = /^#\/character(?:\/(.+))?$/.exec(hash);
  if (character !== null) return { screen: "character", id: character[1] === undefined ? null : decodeFragment(character[1]) };
  return { screen: "party" };
}

function hashOf(route: Route): string {
  if (route.screen === "character") return route.id === null ? "#/character" : `#/character/${encodeURIComponent(route.id)}`;
  return `#/${route.screen}`;
}

/** A run link carries the export string in the fragment (`#BG3P<version>:…`). */
function runLinkIn(hash: string): string | null {
  return hash.startsWith("#BG3P") ? decodeFragment(hash.slice(1)) : null;
}

type Props = {
  data: GameData;
  store: RunStore;
  /** Where the settings live (normally `localStorage`); null when the browser keeps nothing. */
  settingsBackend: Storage | null;
};

/** The app shell: header (runs, screens, language, theme), storage warnings and hash routing; screens plug into the routes. */
export default function App({ data, store, settingsBackend }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(settingsBackend));
  const [runs, setRuns] = useState(() => store.list());
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [incoming, setIncoming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const i18n = useMemo(() => createI18n(settings.lang), [settings.lang]);
  const { t } = i18n;

  const currentId = currentRunId(runs, settings.currentRun);
  const current = runs.find((run) => run.id === currentId) ?? null;
  const unreadable = store.unreadable().length;

  useEffect(() => saveSettings(settingsBackend, settings), [settingsBackend, settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = settings.lang;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.dataset["theme"] = settings.theme;
    document.title = t("app.title");
  }, [settings.lang, settings.theme, t]);

  useEffect(() => {
    const follow = () => {
      const link = runLinkIn(window.location.hash);
      if (link !== null) {
        // The Import / export screen takes the link; the address bar stops carrying it.
        setIncoming(link);
        window.history.replaceState(null, "", "#/transfer");
      }
      setRoute(parseRoute(window.location.hash));
    };
    follow();
    window.addEventListener("hashchange", follow);
    window.addEventListener("popstate", follow);
    return () => {
      window.removeEventListener("hashchange", follow);
      window.removeEventListener("popstate", follow);
    };
  }, []);

  const go = (next: Route) => {
    if (next.screen !== "transfer") setIncoming(null);
    window.history.pushState(null, "", hashOf(next));
    setRoute(next);
  };
  const update = (patch: Partial<Settings>) => setSettings((previous) => ({ ...previous, ...patch }));
  const select = (id: string | null) => {
    setRuns(store.list());
    setRenaming(null);
    setDeleting(false);
    update({ currentRun: id });
  };
  const imported = (id: string) => {
    select(id);
    go({ screen: "party" });
  };
  const runLabel = (name: string) => (name === "" ? t("run.untitled") : name);

  const create = () => select(createRun(store, t("run.defaultName")));
  const rename = (event: FormEvent) => {
    event.preventDefault();
    if (currentId !== null && renaming !== null) select(renameRun(store, currentId, renaming) ?? currentId);
  };
  const duplicate = () => {
    if (currentId !== null) select(duplicateRun(store, currentId, (name) => t("run.copyName", { name: runLabel(name) })) ?? currentId);
  };
  const remove = () => {
    if (currentId !== null) select(deleteRun(store, currentId));
  };

  const tabs = [
    { route: { screen: "party" } as Route, label: t("nav.party") },
    { route: { screen: "character", id: null } as Route, label: t("nav.character") },
    { route: { screen: "transfer" } as Route, label: t("nav.transfer") },
  ];

  return (
    <I18nContext.Provider value={i18n}>
      <header>
        <div className="wrap bar">
          <div className="brand">{t("app.title")}</div>
          <div className="runbar">
            {renaming === null ? (
              <>
                {runs.length > 0 && (
                  <select aria-label={t("run.select")} value={currentId ?? ""} onChange={(event) => select(event.target.value)}>
                    {runs.map((run) => (
                      <option key={run.id} value={run.id}>
                        {runLabel(run.name)}
                      </option>
                    ))}
                  </select>
                )}
                <button className="btn" onClick={create}>
                  {t("run.new")}
                </button>
                {current !== null && (
                  <>
                    <button className="btn" onClick={() => setRenaming(current.name)}>
                      {t("run.rename")}
                    </button>
                    <button className="btn" onClick={duplicate}>
                      {t("run.duplicate")}
                    </button>
                    <button className="btn" onClick={() => setDeleting(true)}>
                      {t("run.delete")}
                    </button>
                  </>
                )}
              </>
            ) : (
              <form className="runbar" onSubmit={rename}>
                <input aria-label={t("run.nameLabel")} value={renaming} onChange={(event) => setRenaming(event.target.value)} autoFocus />
                <button className="btn primary" type="submit">
                  {t("run.ok")}
                </button>
                <button className="btn" type="button" onClick={() => setRenaming(null)}>
                  {t("run.cancel")}
                </button>
              </form>
            )}
          </div>
          <nav aria-label={t("nav.label")}>
            {tabs.map((tab) => (
              <button key={tab.route.screen} aria-current={route.screen === tab.route.screen ? "page" : undefined} onClick={() => go(tab.route)}>
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="prefs">
            <select aria-label={t("settings.language")} value={settings.lang} onChange={(event) => update({ lang: event.target.value as Lang })}>
              {LANGS.map((lang) => (
                <option key={lang} value={lang}>
                  {t(`lang.${lang}`)}
                </option>
              ))}
            </select>
            <select aria-label={t("settings.theme")} value={settings.theme} onChange={(event) => update({ theme: event.target.value as Theme })}>
              {THEMES.map((theme) => (
                <option key={theme} value={theme}>
                  {t(`theme.${theme}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {deleting && current !== null && (
          <div className="wrap confirm">
            <span>{t("run.deleteQuestion", { name: runLabel(current.name) })}</span>
            <button className="btn danger" onClick={remove}>
              {t("run.deleteConfirm")}
            </button>
            <button className="btn" onClick={() => setDeleting(false)}>
              {t("run.cancel")}
            </button>
          </div>
        )}
      </header>
      {!store.available && (
        <div className="banner wrap" role="alert">
          {t("storage.unavailable")}
        </div>
      )}
      {unreadable > 0 && (
        <div className="banner wrap" role="alert">
          {t(unreadable === 1 ? "storage.unreadable" : "storage.unreadable.many", { count: unreadable })}
        </div>
      )}
      <main className="wrap">
        {route.screen === "transfer" ? (
          <Transfer key={incoming ?? ""} data={data} store={store} runId={currentId} initialText={incoming ?? undefined} onImported={imported} />
        ) : current === null ? (
          <p className="sub">{t("run.none")}</p>
        ) : route.screen === "party" ? (
          <Party key={current.id} data={data} store={store} runId={current.id} onChanged={() => setRuns(store.list())} onOpenCharacter={(id) => go({ screen: "character", id })} />
        ) : (
          <p className="sub">{t(`screen.${route.screen}`)}</p>
        )}
      </main>
    </I18nContext.Provider>
  );
}
