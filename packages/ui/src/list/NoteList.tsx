import { memo, useEffect, useState } from 'react';
import type { NoteSummary } from '@mossnote/core/rpc';
import { useApp } from '../app/context';
import { useStore } from '../app/store';

const LOADING_DELAY_MS = 150;

interface RowProps {
  note: NoteSummary;
  selected: boolean;
  active: boolean;
}
// Memoized: an arrow key or an own save re-renders only the rows whose props changed.
const Row = memo(function Row({ note, selected, active }: RowProps) {
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={active ? 0 : -1}
      data-id={note.id}
      id={`note-${note.id}`}
    >
      {note.title || 'Untitled'}
    </li>
  );
});

export function NoteList() {
  const { model } = useApp();
  const s = model.store;
  const notes = useStore(s, (x) => x.notes);
  const list = useStore(s, (x) => x.list);
  const listError = useStore(s, (x) => x.listError);
  const hasMore = useStore(s, (x) => x.hasMore);
  const openId = useStore(s, (x) => x.openId);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showLoading, setShowLoading] = useState(false);

  // "Loading notes…" only appears if loading takes longer than 150 ms (no flash on fast loads).
  useEffect(() => {
    if (list !== 'loading') return setShowLoading(false);
    const h = model.timers.setTimeout(() => setShowLoading(true), LOADING_DELAY_MS);
    return () => model.timers.clearTimeout(h);
  }, [list, model]);

  const active =
    activeId && notes.some((n) => n.id === activeId) ? activeId : (openId ?? notes[0]?.id);

  const move = (to: string | undefined) => {
    if (!to) return;
    setActiveId(to);
    document.getElementById(`note-${to}`)?.focus();
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = notes.findIndex((n) => n.id === active);
    const id = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id') ?? active;
    if (e.key === 'ArrowDown') move(notes[Math.min(notes.length - 1, i + 1)]?.id);
    else if (e.key === 'ArrowUp') move(notes[Math.max(0, i - 1)]?.id);
    else if (e.key === 'Home') move(notes[0]?.id);
    else if (e.key === 'End') move(notes[notes.length - 1]?.id);
    else if (e.key === 'Enter' && id) {
      model.openNote(id);
      model.hooks.focusEditor?.();
    } else if (e.key === 'Delete' && id) {
      // Land focus on the neighbour so keyboard users are not dropped to <body>.
      const j = notes.findIndex((n) => n.id === id);
      const next = notes[j + 1] ?? notes[j - 1];
      const label = notes.find((n) => n.id === id)?.title || 'Untitled';
      void model.actions.deleteNote(id, label).then((r) => r.ok && next && move(next.id));
    } else return;
    e.preventDefault();
  };

  return (
    <>
      <div className="banner">
        <button type="button" onClick={() => void model.createNote()}>
          New note
        </button>
      </div>
      {list === 'error' ? (
        <div className="pane-msg" role="alert">
          <p>Couldn’t load notes: {listError}</p>
          <button type="button" onClick={() => void model.refreshList()}>
            Retry
          </button>
        </div>
      ) : list === 'loading' ? (
        <p className="pane-msg muted">{showLoading ? 'Loading notes…' : ''}</p>
      ) : notes.length === 0 ? (
        <div className="pane-msg">
          <p>No notes yet</p>
        </div>
      ) : (
        <>
          <ul
            role="listbox"
            aria-label="Notes"
            className="notelist"
            onKeyDown={onKeyDown}
            onClick={(e) => {
              const id = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id');
              if (id) {
                setActiveId(id);
                model.openNote(id);
              }
            }}
          >
            {notes.map((n) => (
              <Row key={n.id} note={n} selected={n.id === openId} active={n.id === active} />
            ))}
          </ul>
          {hasMore && (
            <button type="button" onClick={() => void model.loadMore()}>
              Load more
            </button>
          )}
        </>
      )}
    </>
  );
}
