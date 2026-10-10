import { useState, type ReactNode, type SyntheticEvent } from 'react';
import { DEFAULT_TEMPLATE_ID } from '@shared/templates';
import { TemplatePicker } from './TemplatePicker';

export const DEFAULT_JOURNAL_NAME = 'My journal';

/**
 * Name and template for a new journal, used by the first-run screen and by "New journal".
 * Enter in the name field submits. The name is checked here only for being empty; the server has
 * the final say and its plain-language reply is shown under the form.
 */
export function NewJournalForm({
  submitLabel,
  busy,
  error,
  onSubmit,
  actions,
  initialName = DEFAULT_JOURNAL_NAME,
  idPrefix,
}: {
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (input: { name: string; template: string }) => void;
  /** Extra buttons beside the submit button, for example Cancel. */
  actions?: ReactNode;
  initialName?: string;
  idPrefix: string;
}) {
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE_ID);
  const [name, setName] = useState(initialName);
  const [touched, setTouched] = useState(false);
  const empty = name.trim() === '';

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!empty && !busy) onSubmit({ name: name.trim(), template });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <TemplatePicker value={template} onChange={setTemplate} name={`${idPrefix}-template`} />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${idPrefix}-name`} className="font-semibold">
          Journal name
        </label>
        <input
          id={`${idPrefix}-name`}
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-invalid={touched && empty}
          aria-describedby={touched && empty ? `${idPrefix}-name-error` : undefined}
          onChange={(e) => {
            setName(e.target.value);
          }}
          className="field-input"
        />
        {touched && empty ? (
          <p id={`${idPrefix}-name-error`} className="text-sm text-danger">
            Give the journal a name. You can change it later.
          </p>
        ) : (
          <p className="text-sm text-ink-muted">
            Only you see this. It just helps you tell your journals apart.
          </p>
        )}
      </div>
      {error ? (
        <p role="alert" className="text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary tap" disabled={busy}>
          {busy ? 'Just a moment…' : submitLabel}
        </button>
        {actions}
      </div>
    </form>
  );
}
