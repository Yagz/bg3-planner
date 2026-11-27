import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; separatorBefore?: boolean };

type Props = {
  /** The accessible name of the button that opens the menu. */
  label: string;
  /** What the button shows. */
  icon: ReactNode;
  items: MenuItem[];
};

const FOCUSABLE = '[role="menuitem"]';

/** A button that opens a list of actions (menu items only; a panel of form controls is a `Disclosure`). Opens on click; arrow keys move between the entries; Escape, a click outside and a choice close it, Escape and a choice give the focus back to the button. */
export default function Menu({ label, icon, items }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  const entries = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  // Where the focus goes once the panel is mounted; set by the key or click that opens the menu.
  const [focusAt, setFocusAt] = useState<"first" | "last">("first");
  const openAt = (where: "first" | "last") => {
    setFocusAt(where);
    setOpen(true);
  };
  useEffect(() => {
    if (!open) return;
    const list = entries();
    (focusAt === "first" ? list[0] : list[list.length - 1])?.focus();
    // Only when the menu opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.target === button.current) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openAt(event.key === "ArrowDown" ? "first" : "last");
      }
      return;
    }
    if (!open) return;
    const list = entries();
    const at = list.indexOf(event.target as HTMLElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
  };

  return (
    <div
      className="menu"
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Tabbing out of the menu closes it (a null target is the window losing focus: keep it open).
        const to = event.relatedTarget as Node | null;
        if (open && to !== null && !event.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="menubtn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? setOpen(false) : openAt("first"))}
      >
        {icon}
      </button>
      {open && (
        <div className="menupanel" id={panelId} role="menu" aria-label={label} ref={panel}>
          {items.map((item, index) => (
            <div key={index} role="none">
              {item.separatorBefore === true && <hr role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={item.danger === true ? "danger" : undefined}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
