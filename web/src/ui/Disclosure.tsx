import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

type Props = {
  /** The accessible name of the button that shows the panel. */
  label: string;
  /** What the button shows. */
  icon: ReactNode;
  /** The controls of the panel (labelled form fields, not menu items). */
  children: ReactNode;
};

/**
 * A button that shows a panel of controls below it (a disclosure, not a menu: the panel holds form fields). Escape closes it
 * and gives the focus back to the button; a click outside or the focus leaving it closes it; a change in a control does not,
 * so the arrow keys can step through a select's values.
 */
export default function Disclosure({ label, icon, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open]);

  return (
    <div
      className="menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
      onBlur={(event) => {
        // Tabbing out closes it (a null target is the window losing focus: keep it open).
        const to = event.relatedTarget as Node | null;
        if (open && to !== null && !event.currentTarget.contains(to)) setOpen(false);
      }}
    >
      <button ref={button} type="button" className="menubtn" aria-label={label} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
        {icon}
      </button>
      {open && (
        <div className="menupanel" id={panelId} role="group" aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}
