import type { Lang } from "../i18n/i18n.ts";

export type Theme = "system" | "light" | "dark";

export type Settings = {
  lang: Lang;
  theme: Theme;
  /** Character editor shown as a tree rather than a level list. */
  tree: boolean;
  currentRun: string | null;
};

const KEY = "bg3p:settings";

/** Stored settings, each field falling back to its default; the language defaults from the browser's. */
export function loadSettings(backend: Storage | null, language: string = navigator.language): Settings {
  const defaults: Settings = { lang: language.toLowerCase().startsWith("fr") ? "fr" : "en", theme: "system", tree: false, currentRun: null };
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(backend?.getItem(KEY) ?? "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
  } catch {
    // Unreadable or blocked storage: defaults.
  }
  const { lang, theme, tree, currentRun } = stored;
  return {
    lang: lang === "fr" || lang === "en" ? lang : defaults.lang,
    theme: theme === "light" || theme === "dark" || theme === "system" ? theme : defaults.theme,
    tree: typeof tree === "boolean" ? tree : defaults.tree,
    currentRun: typeof currentRun === "string" ? currentRun : defaults.currentRun,
  };
}

/** Stores the settings; a failing storage only loses them for the next visit. */
export function saveSettings(backend: Storage | null, settings: Settings): void {
  try {
    backend?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Settings are a convenience: the run store's banner already tells the user storage is not working.
  }
}
