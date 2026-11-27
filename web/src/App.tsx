import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GameData } from "../../src/data/types.ts";
import { I18nContext, LANGS, createI18n } from "./i18n/i18n.ts";
import Character from "./screens/Character.tsx";
import HistoryPanel from "./screens/HistoryPanel.tsx";
import Party from "./screens/Party.tsx";
import Transfer from "./screens/Transfer.tsx";
import Disclosure from "./ui/Disclosure.tsx";
import Menu from "./ui/Menu.tsx";
import type { Lang } from "./i18n/i18n.ts";
import { createRun, currentRunId, deleteRun, duplicateRun, renameRun } from "./state/runs.ts";
import { loadSettings, saveSettings } from "./state/settings.ts";
import type { Settings, Theme } from "./state/settings.ts";
import type { RunStore } from "./state/storage.ts";
import type { Run } from "../../src/plan/model.ts";

type Route = { screen: "party" } | { screen: "character"; id: string | null } | { screen: "history" } | { screen: "transfer" };

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
  if (hash === "#/history") return { screen: "history" };
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
  /** Where the open character tab is remembered for the session (normally `sessionStorage`); null when unavailable. */
  sessionBackend: Storage | null;
};

/** The app shell: header (screens, runs and settings menus), storage warnings and hash routing; screens plug into the routes. */
export default function App({ data, store, settingsBackend, sessionBackend }: Props) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings(settingsBackend));
  const [runs, setRuns] = useState(() => store.list());
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  const [incoming, setIncoming] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const i18n = useMemo(() => createI18n(settings.lang), [settings.lang]);
  const { t } = i18n;

  const currentId = currentRunId(runs, settings.currentRun);
  const current = runs.find((summary) => summary.id === currentId) ?? null;
  // The current run is read from the store here and nowhere else; screens receive it and `saveRun`.
  const [run, setRun] = useState<Run | null>(() => (currentId === null ? null : store.load(currentId)));
  const unreadable = store.unreadable().length;

  useEffect(() => saveSettings(settingsBackend, settings), [settingsBackend, settings]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = settings.lang;
    if (settings.theme === "system") root.removeAttribute("data-theme");
    else root.dataset["theme"] = settings.theme;
    document.title = t("app.title");
  }, [settings.lang, settings.theme, t]);

  // Another tab saved, added or removed a run: read the store again and show its current version of the run.
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith("bg3p:run:")) return;
      store.refresh();
      const list = store.list();
      const target = currentRunId(list, settings.currentRun);
      setRun(target === null ? null : store.load(target));
      setRuns(list);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [store, settings.currentRun]);

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
    const list = store.list();
    const target = currentRunId(list, id);
    setRun(target === null ? null : store.load(target));
    setRuns(list);
    setRenaming(null);
    setDeleting(false);
    update({ currentRun: id });
  };
  /** Saves a new version of the current run through the store and shows it; throws (nothing changed) when the store refuses. */
  const saveRun = (next: Run) => {
    const saved = store.save(next);
    setRun(saved);
    setRuns(store.list());
  };
  /** Restores a saved version of the current run as a new version (so the replaced one stays in the history) and shows it. */
  const restoreVersion = (at: string) => {
    if (currentId === null) return;
    setRun(store.restore(currentId, at));
    setRuns(store.list());
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
    { route: { screen: "history" } as Route, label: t("nav.history") },
    { route: { screen: "transfer" } as Route, label: t("nav.transfer") },
  ];

  return (
    <I18nContext.Provider value={i18n}>
      <header className="appbar">
        <div className="wrap bar">
          <div className="brand">
            {t("app.title")
              .split("BG3")
              .flatMap((part, index) => (index === 0 ? [part] : [<b key={index}>BG3</b>, part]))}
          </div>
          <nav aria-label={t("nav.label")}>
            {tabs.map((tab) => (
              <button key={tab.route.screen} aria-current={route.screen === tab.route.screen ? "page" : undefined} onClick={() => go(tab.route)}>
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="runbar">
            {renaming !== null ? (
              <form className="runbar" onSubmit={rename}>
                <input aria-label={t("run.nameLabel")} value={renaming} onChange={(event) => setRenaming(event.target.value)} autoFocus />
                <button className="btn primary" type="submit">
                  {t("run.ok")}
                </button>
                <button className="btn" type="button" onClick={() => setRenaming(null)}>
                  {t("run.cancel")}
                </button>
              </form>
            ) : current === null ? (
              <button className="btn primary" onClick={create}>
                {t("run.new")}
              </button>
            ) : (
              <>
                <select aria-label={t("run.select")} value={currentId ?? ""} onChange={(event) => select(event.target.value)}>
                  {runs.map((run) => (
                    <option key={run.id} value={run.id}>
                      {runLabel(run.name)}
                    </option>
                  ))}
                </select>
                <Menu
                  label={t("header.runMenu")}
                  icon="⋯"
                  items={[
                    { label: t("run.new"), onSelect: create },
                    { label: t("run.rename"), onSelect: () => setRenaming(current.name) },
                    { label: t("run.duplicate"), onSelect: duplicate },
                    { label: t("run.delete"), onSelect: () => setDeleting(true), danger: true, separatorBefore: true },
                  ]}
                />
              </>
            )}
            <Disclosure
              label={t("header.settings")}
              icon={
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 5h14M2 13h14" />
                  <circle cx="6" cy="5" r="2" fill="var(--head-bg)" />
                  <circle cx="12" cy="13" r="2" fill="var(--head-bg)" />
                </svg>
              }
            >
              <div className="setting">
                <label>
                  {t("settings.language")}
                  <select value={settings.lang} onChange={(event) => update({ lang: event.target.value as Lang })}>
                    {LANGS.map((lang) => (
                      <option key={lang} value={lang}>
                        {t(`lang.${lang}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="setting">
                <label>
                  {t("settings.theme")}
                  <select value={settings.theme} onChange={(event) => update({ theme: event.target.value as Theme })}>
                    {THEMES.map((theme) => (
                      <option key={theme} value={theme}>
                        {t(`theme.${theme}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Disclosure>
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
          <Transfer key={incoming ?? ""} data={data} store={store} run={run} initialText={incoming ?? undefined} onImported={imported} />
        ) : current === null || run === null ? (
          <p className="sub">{t("run.none")}</p>
        ) : route.screen === "history" ? (
          <HistoryPanel data={data} name={runLabel(current.name)} versions={store.history(current.id)} onRestore={restoreVersion} />
        ) : route.screen === "party" ? (
          <Party data={data} run={run} saveRun={saveRun} onOpenCharacter={(id) => go({ screen: "character", id })} />
        ) : (
          <Character
            data={data}
            run={run}
            saveRun={saveRun}
            characterId={route.id}
            sessionBackend={sessionBackend}
            onSelect={(id) => go({ screen: "character", id })}
            tree={settings.tree}
            onTree={(tree) => update({ tree })}
          />
        )}
      </main>
      <footer className="wrap sitefoot">
        <p>
          {t("footer.wiki")} <a href="https://bg3.wiki" rel="noreferrer">bg3.wiki</a>, <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" rel="noreferrer">CC BY-NC-SA 4.0</a>
        </p>
      </footer>
    </I18nContext.Provider>
  );
}
