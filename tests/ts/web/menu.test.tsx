import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("moves to the first and last entries with Home and End", () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" }));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" }));
  });

  it("focuses the first entry when opened and the last when opened with ArrowUp", () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "One" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    fireEvent.keyDown(button, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Three" }));
  });

  it("closes when the focus tabs out of it, without taking the focus back", () => {
    const { button } = renderMenu();
    fireEvent.click(button);
    const outside = screen.getByRole("button", { name: "outside" });
    act(() => outside.focus());
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it("holds a custom entry, keeps the arrows of a select to itself and closes on a change in it", () => {
    const onChange = vi.fn();
    render(
      <Menu
        label="Settings"
        icon="s"
        items={[
          { label: "Plain", onSelect: () => {} },
          {
            custom: (
              <select aria-label="Mode" onChange={onChange}>
                <option value="a">A</option>
                <option value="b">B</option>
              </select>
            ),
          },
        ]}
      />,
    );
    const button = screen.getByRole("button", { name: "Settings" });
    fireEvent.click(button);
    const select = screen.getByRole("combobox", { name: "Mode" });
    // The select is reachable with the arrows, and an arrow key on it is not taken over.
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Plain" }), { key: "ArrowDown" });
    expect(document.activeElement).toBe(select);
    expect(fireEvent.keyDown(select, { key: "ArrowDown" })).toBe(true);
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
});
