import { useId, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useStore } from '../app/store';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useModal } from '../dialog/useModal';
import type { SavedSearch } from './searchStore';

export interface SaveSearchDialogProps {
  title: string;
  initial: string;
  /** Resolves to an error message to show, or nothing when done (the caller closes it). */
  onSubmit(name: string): Promise<string | void>;
  onCancel(): void;
}

/** A named-value modal (save, rename). Mount = open. */
export function SaveSearchDialog(p: SaveSearchDialogProps) {
  const [name, setName] = useState(p.initial.slice(0, 80));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const field = useRef<HTMLInputElement>(null);
  const { ref, onKeyDown } = useModal(p.onCancel, field);
  const submit = async () => {
    const n = name.trim();
    if (!n) return setErr('A saved search needs a name.');
    setBusy(true);
    const m = await p.onSubmit(n);
    setBusy(false);
    if (m) setErr(m);
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && p.onCancel()}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={titleId}>{p.title}</h2>
          <label>
            Name
            <input
              ref={field}
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {err && <p role="alert">{err}</p>}
          <div className="modal-actions">
            <button type="button" onClick={p.onCancel}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

type Dlg = { kind: 'rename' | 'delete'; s: SavedSearch } | { kind: 'reset' } | null;

/** Nav-pane section: apply, rename, delete; a corrupt store offers an explicit reset. */
export function SavedSearches() {
  const { model } = useApp();
  const search = model.search;
  const saved = useStore(search, (x) => x.saved);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [err, setErr] = useState('');
  const fail = (m: string) => setErr(m);

  return (
    <section aria-label="Saved searches" className="saved-searches">
      <h2>Saved searches</h2>
      {saved.status === 'error' ? (
        <div role="alert">
          <p>{saved.error}</p>
          {saved.corrupt ? (
            <button type="button" onClick={() => setDlg({ kind: 'reset' })}>
              Reset saved searches
            </button>
          ) : (
            <button type="button" onClick={() => void search.loadSaved()}>
              Retry
            </button>
          )}
        </div>
      ) : saved.items.length === 0 ? (
        <p className="muted">{saved.status === 'loading' ? 'Loading…' : 'None yet'}</p>
      ) : (
        <ul aria-label="Saved searches list">
          {saved.items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => search.apply(s)}>
                {s.name}
              </button>
              <button
                type="button"
                aria-label={`Rename saved search ${s.name}`}
                onClick={() => setDlg({ kind: 'rename', s })}
              >
                Rename
              </button>
              <button
                type="button"
                aria-label={`Delete saved search ${s.name}`}
                onClick={() => setDlg({ kind: 'delete', s })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert">{err}</p>}
      {dlg?.kind === 'rename' && (
        <SaveSearchDialog
          title={`Rename saved search “${dlg.s.name}”`}
          initial={dlg.s.name}
          onCancel={() => setDlg(null)}
          onSubmit={async (name) => {
            const r = await model.client.call('search.saved.rename', { id: dlg.s.id, name });
            if (!r.ok) return r.error.message;
            setDlg(null);
            await search.loadSaved();
          }}
        />
      )}
      {dlg?.kind === 'delete' && (
        <ConfirmDialog
          title={`Delete saved search “${dlg.s.name}”?`}
          description="The saved search is removed. Your notes are not affected."
          confirmLabel="Delete saved search"
          onCancel={() => setDlg(null)}
          onConfirm={async () => {
            const r = await model.client.call('search.saved.delete', { id: dlg.s.id });
            if (!r.ok) fail(r.error.message);
            else setErr('');
            setDlg(null);
            await search.loadSaved();
          }}
        />
      )}
      {dlg?.kind === 'reset' && (
        <ConfirmDialog
          title="Reset saved searches?"
          description="Saved searches could not be read. Resetting starts an empty list; the damaged data is kept aside."
          confirmLabel="Reset saved searches"
          onCancel={() => setDlg(null)}
          onConfirm={async () => {
            const r = await model.client.call('search.saved.reset');
            if (!r.ok) fail(r.error.message);
            else setErr('');
            setDlg(null);
            await search.loadSaved();
          }}
        />
      )}
    </section>
  );
}
