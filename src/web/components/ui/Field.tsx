import { useId, type ReactNode } from 'react';

/** What a control needs to be wired to its label, hint and error. Spread it onto the input. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
}

/** The look of a text input, textarea or select. */
export const FIELD_CLASS = 'field-input';

/**
 * A label above a control, with optional hint and error text. The label is always visible, so a
 * placeholder is never the only name. The control is passed as a function so it gets its wiring.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (control: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children({
        id,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
