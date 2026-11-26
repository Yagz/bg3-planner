export type CharacterTab = "sheet" | "notes";

const key = (characterId: string) => `bg3p:tab:${characterId}`;

/** The tab last open on a character in this browser session; the sheet when nothing, or anything unknown, is stored or the storage is unreadable. */
export function loadTab(backend: Storage | null, characterId: string): CharacterTab {
  try {
    const stored = backend?.getItem(key(characterId));
    return stored === "notes" ? "notes" : "sheet";
  } catch {
    return "sheet";
  }
}

/** Remembers the open tab of a character for the session; a failing storage only loses it. */
export function saveTab(backend: Storage | null, characterId: string, tab: CharacterTab): void {
  try {
    backend?.setItem(key(characterId), tab);
  } catch {
    // The open tab is a convenience.
  }
}
