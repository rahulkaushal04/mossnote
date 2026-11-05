import { useRef } from 'react';

export interface SplitterProps {
  label: string;
  /** id of the pane this splitter resizes. */
  controls: string;
  value: number;
  min: number;
  max: number;
  onChange(v: number): void;
  /** Enter toggles collapse when given. */
  onToggle?(): void;
}

const STEP = 16;
const BIG = 64;

export function Splitter(p: SplitterProps) {
  const drag = useRef<{ x: number; v: number } | null>(null);
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? BIG : STEP;
    const next =
      e.key === 'ArrowLeft'
        ? p.value - step
        : e.key === 'ArrowRight'
          ? p.value + step
          : e.key === 'Home'
            ? p.min
            : e.key === 'End'
              ? p.max
              : undefined;
    if (next !== undefined) {
      e.preventDefault();
      p.onChange(Math.min(p.max, Math.max(p.min, next)));
    } else if (e.key === 'Enter' && p.onToggle) {
      e.preventDefault();
      p.onToggle();
    }
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={p.label}
      aria-controls={p.controls}
      aria-valuenow={p.value}
      aria-valuemin={p.min}
      aria-valuemax={p.max}
      tabIndex={0}
      className="splitter"
      onKeyDown={key}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, v: p.value };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) p.onChange(Math.min(p.max, Math.max(p.min, d.v + e.clientX - d.x)));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
    />
  );
}
