import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Disclosure from "../../../web/src/ui/Disclosure.tsx";

afterEach(cleanup);

function renderPanel(onChange = vi.fn()) {
  render(
    <div>
      <button>outside</button>
      <Disclosure label="Settings" icon="s">
        <label>
          Mode
          <select onChange={onChange}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </label>
      </Disclosure>
    </div>,
  );
  return { button: screen.getByRole("button", { name: "Settings" }), onChange };
}

describe("disclosure", () => {
  it("is a button with aria-expanded and aria-controls over a panel without menu roles", () => {
    const { button } = renderPanel();
    expect(button.hasAttribute("aria-haspopup")).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "Mode" })).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(button.getAttribute("aria-controls")!)!;
    expect(panel.contains(screen.getByRole("combobox", { name: "Mode" }))).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open on a change in a control and leaves its arrow keys alone", () => {
    const { button, onChange } = renderPanel();
    fireEvent.click(button);
    const select = screen.getByRole("combobox", { name: "Mode" });
    select.focus();
    expect(fireEvent.keyDown(select, { key: "ArrowDown" })).toBe(true);
    fireEvent.change(select, { target: { value: "b" } });
    fireEvent.change(select, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(select);
  });

  it("closes on Escape and gives the focus back to the button", () => {
    const { button } = renderPanel();
    fireEvent.click(button);
    const select = screen.getByRole("combobox", { name: "Mode" });
    select.focus();
    fireEvent.keyDown(select, { key: "Escape" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("combobox", { name: "Mode" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside click but not on a click inside", () => {
    const { button } = renderPanel();
    fireEvent.click(button);
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Mode" }));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when the focus leaves it, without taking the focus back", () => {
    const { button } = renderPanel();
    fireEvent.click(button);
    act(() => screen.getByRole("combobox", { name: "Mode" }).focus());
    const outside = screen.getByRole("button", { name: "outside" });
    act(() => outside.focus());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(outside);
  });
});
