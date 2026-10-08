/** Small building blocks shared by the inspector's sections. */
import type { ReactNode } from 'react';

export const FIELD_CLASS = 'field-input w-full text-sm';
export const BUTTON_CLASS = 'btn tap px-2 text-sm';
const HEADING_CLASS = 'm-0 text-sm font-semibold text-ink-2';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <h3 className={HEADING_CLASS}>{title}</h3>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span className="font-semibold">{label}</span>
      {children}
    </div>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** A row of buttons where exactly one is pressed, announced as a group. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  wrap = false,
}: {
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T | undefined;
  onChange: (value: T) => void;
  wrap?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className={`flex gap-1 ${wrap ? 'flex-wrap' : ''}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={BUTTON_CLASS}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
