import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LIMITS } from '@shared/constants';
import type { CustomField } from '@shared/types';
import { api } from '../../lib/api';
import { queryKeys } from '../../lib/queryKeys';
import { CloseIcon } from './icons';

/**
 * Label and value rows (spec section 5.10), not a schema builder: no types, no templates.
 * Labels autocomplete from labels already used on other records of the same kind.
 */
export function FieldList({
  fields,
  kind,
  onChange,
}: {
  fields: readonly CustomField[];
  kind: 'person' | 'planting';
  onChange: (fields: CustomField[]) => void;
}) {
  const listId = useId();
  const [focusedLabel, setFocusedLabel] = useState('');
  const labels = useQuery({
    queryKey: queryKeys.fieldLabels(kind, focusedLabel),
    queryFn: () => api.fieldLabels(kind, focusedLabel),
  });
  const lower = fields.map((f) => f.label.trim().toLowerCase());

  const set = (index: number, patch: Partial<CustomField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  };

  return (
    <div className="flex flex-col gap-3">
      <datalist id={listId}>
        {(labels.data?.labels ?? []).map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>
      {fields.map((field, index) => {
        const duplicate =
          field.label.trim() !== '' && lower.indexOf(field.label.trim().toLowerCase()) !== index;
        return (
          <div key={index} className="flex flex-wrap items-start gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="sr-only">Field label {index + 1}</span>
              <input
                list={listId}
                value={field.label}
                maxLength={LIMITS.customFieldLabel}
                placeholder="Label"
                aria-invalid={duplicate ? true : undefined}
                onFocus={() => {
                  setFocusedLabel(field.label);
                }}
                onChange={(e) => {
                  setFocusedLabel(e.target.value);
                  set(index, { label: e.target.value });
                }}
                className="tap w-40 rounded-control border border-ink-muted bg-paper px-2"
              />
              {duplicate ? (
                <span role="alert" className="text-danger">
                  That label is already used here.
                </span>
              ) : null}
            </label>
            <label className="flex min-w-48 flex-1 flex-col text-sm">
              <span className="sr-only">Field value {index + 1}</span>
              <input
                value={field.value}
                maxLength={LIMITS.customFieldValue}
                placeholder="Value"
                onChange={(e) => {
                  set(index, { value: e.target.value });
                }}
                className="tap w-full rounded-control border border-ink-muted bg-paper px-2"
              />
            </label>
            <button
              type="button"
              className="tap text-ink-muted hover:text-danger"
              aria-label={`Remove field ${field.label || index + 1}`}
              onClick={() => {
                onChange(fields.filter((_, i) => i !== index));
              }}
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
      {fields.length < LIMITS.customFields ? (
        <div>
          <button
            type="button"
            className="btn tap text-sm"
            onClick={() => {
              onChange([...fields, { label: '', value: '' }]);
            }}
          >
            Add field
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Fields that can be saved: a label is required, and labels must be unique. */
export function savableFields(fields: readonly CustomField[]): CustomField[] | null {
  const seen = new Set<string>();
  const out: CustomField[] = [];
  for (const f of fields) {
    const label = f.label.trim();
    if (label === '') continue;
    if (seen.has(label.toLowerCase())) return null;
    seen.add(label.toLowerCase());
    out.push({ label, value: f.value });
  }
  return out;
}
