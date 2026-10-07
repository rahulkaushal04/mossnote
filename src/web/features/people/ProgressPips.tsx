/**
 * A row of pips the user clicks to set. A radio-group style control: arrow
 * keys move, Space or Enter sets, and choosing the current value again clears it to zero.
 */
export function ProgressPips({
  value,
  max,
  onChange,
  label = 'Progress',
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${label}: ${value} of ${max}`}
      className="flex flex-wrap gap-1"
    >
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => {
        const filled = n <= value;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} of ${max}`}
            tabIndex={n === Math.max(value, 1) ? 0 : -1}
            onClick={() => {
              onChange(n === value ? 0 : n);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                e.preventDefault();
                onChange(Math.min(max, value + 1));
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                e.preventDefault();
                onChange(Math.max(0, value - 1));
              }
            }}
            className="tap flex items-center justify-center rounded-full"
          >
            <span
              aria-hidden="true"
              className={`block size-4 rounded-full border border-ink-muted ${filled ? 'border-accent bg-accent' : ''}`}
            />
          </button>
        );
      })}
    </div>
  );
}

/** Read-only pips for list rows. */
export function PipsInline({ value, max }: { value: number; max: number }) {
  return (
    <span role="img" aria-label={`${value} of ${max}`} className="inline-flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`block size-2 rounded-full border border-ink-muted ${i < value ? 'border-accent bg-accent' : ''}`}
        />
      ))}
    </span>
  );
}
