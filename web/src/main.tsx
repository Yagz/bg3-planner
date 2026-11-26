import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GameData } from "../../src/data/types.ts";
import App from "./App.tsx";
import "./app.css";
import { loadGameDataFromUrl } from "./data/loadInBrowser.ts";
import { createI18n } from "./i18n/i18n.ts";
import { loadSettings } from "./state/settings.ts";
import { createStore } from "./state/storage.ts";

/** `localStorage`, or null where the browser refuses it (some private modes throw on access). */
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `sessionStorage`, or null where the browser refuses it. */
function sessionStorageOrNull(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const backend = browserStorage();
const session = sessionStorageOrNull();
const store = createStore(backend);

function Root() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = createI18n(loadSettings(backend).lang);

  useEffect(() => {
    loadGameDataFromUrl(import.meta.env.BASE_URL).then(setData, (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, []);

  if (data !== null) return <App data={data} store={store} settingsBackend={backend} sessionBackend={session} />;
  return <p className="wrap sub">{error === null ? t("app.loading") : t("app.loadError", { message: error })}</p>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
