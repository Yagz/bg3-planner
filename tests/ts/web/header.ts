import { fireEvent, screen } from "@testing-library/react";

/** Opens a header menu by the name of its button (English or French) unless it is already open, and returns the button. */
function open(name: RegExp): HTMLElement {
  const button = screen.getByRole("button", { name });
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  return button;
}

/** Runs an action of the run menu (« ⋯ »), e.g. `runAction("Rename")`. */
export function runAction(name: string): void {
  open(/^(Run actions|Actions sur la partie)$/);
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

/** Switches the interface language through the settings menu. */
export function setLanguage(lang: "en" | "fr"): void {
  open(/^(Settings|Réglages)$/);
  fireEvent.change(screen.getByRole("combobox", { name: /^(Language|Langue)$/ }), { target: { value: lang } });
}

/** Sets the theme through the settings menu. */
export function setTheme(theme: "system" | "light" | "dark"): void {
  open(/^(Settings|Réglages)$/);
  fireEvent.change(screen.getByRole("combobox", { name: /^(Theme|Thème)$/ }), { target: { value: theme } });
}
