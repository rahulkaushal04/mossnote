import { focusOnMount } from '../focusOnMount';

/** The box that opens under a marker just placed, so it can be named at once. */
export function MarkerNameInput({
  at,
  label,
  onSave,
  onClose,
}: {
  /** Screen position of the marker. */
  at: { x: number; y: number };
  label: string;
  /** Called with the typed name on Enter or when focus leaves. */
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  return (
    <input
      ref={focusOnMount}
      aria-label="Marker name"
      placeholder="Name it, then Enter"
      maxLength={80}
      defaultValue={label}
      className="tap absolute z-20 w-48 -translate-x-1/2 rounded-md border border-accent bg-raised px-2 shadow-2"
      style={{ left: at.x, top: at.y + 20 }}
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          onSave(e.currentTarget.value);
          onClose();
        } else if (e.key === 'Escape') onClose();
      }}
      onBlur={(e) => {
        onSave(e.currentTarget.value);
        onClose();
      }}
    />
  );
}

/** A dashed ring round the last marker dropped while exploring. */
export function LastMarkerRing({
  at,
  width,
  height,
}: {
  at: { x: number; y: number };
  width: number;
  height: number;
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5]"
      width={width}
      height={height}
      aria-hidden="true"
    >
      <circle
        cx={at.x}
        cy={at.y}
        r={20}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.5}
        strokeDasharray="4 3"
      />
    </svg>
  );
}
