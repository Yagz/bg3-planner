import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../../../web/src/App.tsx";
import { createStore } from "../../../web/src/state/storage.ts";
import type { RunStore } from "../../../web/src/state/storage.ts";
import { MemoryBackend } from "./memoryBackend.ts";
import { stubData } from "./stubData.ts";

function renderApp(store: RunStore = createStore(new MemoryBackend()), settings = new MemoryBackend()) {
  render(<App data={stubData()} store={store} settingsBackend={settings} />);
  return { store, settings };
}

function runSelector(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: /run|partie/i }) as HTMLSelectElement;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

describe("app shell", () => {
  it("renders with an empty store", () => {
    renderApp();
    expect(screen.getByRole("navigation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Party" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Character" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import / export" })).toBeTruthy();
    expect(screen.getByText("No run yet: create one or import one.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates, renames, duplicates and deletes a run", () => {
    const { store, settings } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(store.list().map((summary) => summary.name)).toEqual(["New run"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("New run");
    expect(JSON.parse(settings.items.get("bg3p:settings")!).currentRun).toBe(store.list()[0]?.id);

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "Dark urges" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");

    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(store.list().map((summary) => summary.name).sort()).toEqual(["Dark urges", "Dark urges (copy)"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges (copy)");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete for good" }));
    expect(store.list().map((summary) => summary.name)).toEqual(["Dark urges"]);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("Dark urges");
  });

  it("switches language without losing the run", () => {
    const { store } = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Run name" }), { target: { value: "My run" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    const id = runSelector().value;

    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "fr" } });
    expect(screen.getByRole("button", { name: "Partie" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("fr");
    expect(runSelector().value).toBe(id);
    expect(runSelector().selectedOptions[0]?.textContent).toBe("My run");
    expect(store.list()).toHaveLength(1);
  });

  it("shows a persistent banner when storage is unavailable", () => {
    renderApp(createStore(null));
    expect(screen.getByRole("alert").textContent).toMatch(/not saved in this browser/);
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    fireEvent.click(screen.getByRole("button", { name: "Import / export" }));
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("warns about stored runs it cannot read", () => {
    const backend = new MemoryBackend();
    backend.items.set("bg3p:run:bad", "{not json");
    renderApp(createStore(backend));
    expect(screen.getByRole("alert").textContent).toMatch(/1 stored run could not be read/);
  });

  it("sets the theme on the document element, system removes it", () => {
    renderApp();
    const theme = screen.getByRole("combobox", { name: "Theme" });
    fireEvent.change(theme, { target: { value: "dark" } });
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    fireEvent.change(theme, { target: { value: "system" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("routes by hash and hands a run link to the import flow", () => {
    window.history.replaceState(null, "", "/#/transfer");
    renderApp();
    expect(screen.getByRole("button", { name: "Import / export" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Party" }));
    expect(window.location.hash).toBe("#/party");
    act(() => {
      window.history.replaceState(null, "", "/#BG3P2:abc");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/party");
    expect(within(screen.getByRole("main")).getByText(/BG3P2:abc/)).toBeTruthy();
  });

  it("survives a malformed fragment", () => {
    window.history.replaceState(null, "", "/#/character/%E0");
    renderApp();
    expect(screen.getByRole("button", { name: "Character" }).getAttribute("aria-current")).toBe("page");
    act(() => {
      window.history.replaceState(null, "", "/#BG3P%E0");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/party");
    expect(within(screen.getByRole("main")).getByText(/BG3P%E0/)).toBeTruthy();
  });
});
