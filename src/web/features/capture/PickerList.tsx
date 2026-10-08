import type { KeyboardEvent, RefObject } from 'react';
import type { PickerRow } from './usePicker';

export const optionId = (listId: string, index: number): string => `${listId}-option-${index}`;

/**
 * The caret-anchored listbox. Rows are options of the textarea's combobox; the highlighted row is
 * exposed through `aria-activedescendant` on the textarea, and the result count is announced.
 */
export function PickerList({
  id,
  rows,
  active,
  onHover,
  onSelect,
  emptyText,
  top,
  left,
  search,
  searchInputRef,
}: {
  id: string;
  rows: PickerRow[];
  active: number;
  onHover: (index: number) => void;
  onSelect: (row: PickerRow) => void;
  emptyText: string;
  top: number;
  left: number;
  /** A filter box, for pickers opened by a button or command (there is no typed text to filter on). */
  searchInputRef?: RefObject<HTMLInputElement | null>;
  search?: {
    value: string;
    onChange: (value: string) => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
    activeId: string | undefined;
    listId: string;
  };
}) {
  return (
    <div
      className="absolute z-30 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-raised p-1 shadow-2"
      style={{ top, left }}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {rows.length === 0
          ? 'No results'
          : `${rows.length} ${rows.length === 1 ? 'result' : 'results'}`}
      </p>
      {search ? (
        <input
          ref={searchInputRef}
          role="combobox"
          aria-label="Find"
          aria-expanded="true"
          aria-controls={search.listId}
          aria-activedescendant={search.activeId}
          aria-autocomplete="list"
          value={search.value}
          onChange={(e) => {
            search.onChange(e.target.value);
          }}
          onKeyDown={search.onKeyDown}
          placeholder="Search…"
          className="field-input mb-1 w-full"
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="px-3 py-2 text-ink-muted">{emptyText}</p>
      ) : (
        <div id={id} role="listbox" aria-label="Suggestions">
          {rows.map((row, index) => (
            <div
              key={row.key}
              id={optionId(id, index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseEnter={() => {
                onHover(index);
              }}
              // Keep focus in the textarea: the click selects without blurring.
              onMouseDown={(event) => {
                event.preventDefault();
                onSelect(row);
              }}
              className={`tap flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-1.5 ${
                index === active ? 'bg-surface' : ''
              }`}
            >
              <span className="truncate">{row.label}</span>
              {row.kind || row.detail ? (
                <span className="shrink-0 text-sm text-ink-muted">
                  {[row.kind, row.detail].filter(Boolean).join(' · ')}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
