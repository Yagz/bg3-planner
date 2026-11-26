/** A neutral line drawing of a figure for the equipment tab; decorative, drawn in the stylesheet's `--faint`. */
export default function Silhouette() {
  return (
    <svg viewBox="0 0 120 260" aria-hidden="true" focusable="false">
      <circle cx="60" cy="30" r="17" />
      <path d="M60 47v8M34 66q26-14 52 0l6 70-10 2-6-50v72H44V88l-6 50-10-2z" />
      <path d="M44 160l-4 92h14l6-70 6 70h14l-4-92" />
    </svg>
  );
}
