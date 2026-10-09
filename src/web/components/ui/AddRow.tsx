import type { ReactNode, RefObject } from 'react';
import { Button } from './Button';
import { PlusIcon } from './icons';

/**
 * The one-line "add" control at the top of a list (People, Farm, Maps): a plus, a field and the
 * button in a single rounded row, instead of a label over a field beside a button. The label is
 * there for screen readers; sighted users read the placeholder, which says the same thing.
 * `note` is for the message under the row (an error, "someone with this name already exists").
 */
export function AddRow({
  id,
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  submitLabel = 'Add',
  busy = false,
  invalid = false,
  describedBy,
  listId,
  inputRef,
  note,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel?: string;
  busy?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
  /** The id of a `<datalist>` of earlier names to suggest. */
  listId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  note?: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="add-row">
        <PlusIcon aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
        <input
          id={id}
          ref={inputRef}
          list={listId}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          className="add-row-input"
        />
        <Button type="submit" variant="primary" busy={busy} className="shrink-0">
          {submitLabel}
        </Button>
      </div>
      {note}
    </form>
  );
}
