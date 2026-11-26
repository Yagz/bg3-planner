import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Menu from "../../../web/src/ui/Menu.tsx";

afterEach(cleanup);

function renderMenu(onSelect = vi.fn()) {
  render(
    <div>
      <button>outside</button>
      <Menu label="Actions" icon="⋯" items={[{ label: "One", onSelect }, { label: "Two", onSelect: () => {} }, { label: "Three", onSelect: () => {}, danger: true, separatorBefore: true }]} />
    </div>,
  );
  return { button: screen.getByRole("button", { name: "Actions" }), onSelect };
}

describe("menu", () => {
  it("opens on click, closes on Escape and gives focus back", () => {
    const { button } = renderMenu();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["One", "Two", "Three"]);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Two" }), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside click", () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "One" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("runs the item and closes", () => {
    const { button, onSelect } = renderMenu();
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("menuitem", { name: "One" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("moves with the arrow keys", async () => {
    const { button } = renderMenu();
    button.focus();
    fireEvent.keyDown(button, { key: "ArrowDown" });
    await vi.waitFor(() => expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" })));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Two" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" }));
  });
});
