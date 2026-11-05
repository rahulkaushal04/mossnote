import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TrashItem } from '@mossnote/core/rpc';
import { ConfirmDialog } from '../dialog/ConfirmDialog';
import { useLoad } from '../nav/useLoad';
import type { Client } from '../rpc/client';

export interface TrashViewProps {
  client: Client;
  /** Recovery action for the empty state ("Back to all notes"). */
  onBack?(): void;
  /** When given, each note row gets an "Open" button (the editor shows it read-only). */
  onOpenNote?(id: string): void;
  /** After a restore, with the sentence shown to the user (where the item landed). */
  onRestored?(item: TrashItem, notice: string): void;
}

const quoted = (s: string) => `"${s}"`;

/** Where a restored item ended up, in words. Folders and notes whose parent is Trash go to the top. */
async function landing(client: Client, item: TrashItem): Promise<string> {
  const fl = await client.call('folders.list');
  const folders = fl.ok ? fl.value : [];
  const where = (parentId: string | null | undefined) => {
    if (!parentId) return 'at the top level';
    const p = folders.find((f) => f.id === parentId);
    return p ? `in ${quoted(p.name)}` : 'at the top level';
  };
  if (item.entity === 'folder') {
    const f = folders.find((x) => x.id === item.id);
    return `Restored folder ${quoted(item.label)} ${where(f?.parentId)}.`;
  }
  const n = await client.call('notes.get', { id: item.id });
  return `Restored ${quoted(item.label)} ${where(n.ok ? n.value.folderId : null)}.`;
}

/**
 * The Trash list. Each row: Restore and "Delete permanently…" (a ConfirmDialog naming the item).
 * Keyboard: Up/Down/Home/End move between rows, Enter restores, Delete asks to delete permanently.
 * Reloads on `changed` events, so a delete elsewhere shows up here without a refresh.
 */
export function TrashView({ client, onBack, onOpenNote, onRestored }: TrashViewProps) {
  const t = useLoad(client, () => client.call('trash.list'), ['trash']);
  const [asking, setAsking] = useState<TrashItem | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focusAfter = useRef<string | 'heading' | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const items = t.data ?? [];
  const activeId = items.some((i) => i.batchId === active) ? active : items[0]?.batchId;

  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    if (f === 'heading') headingRef.current?.focus();
    else listRef.current?.querySelector<HTMLElement>(`[data-batch="${f}"]`)?.focus();
    focusAfter.current = null;
  });

  const neighbour = (id: string): string | 'heading' => {
    const i = items.findIndex((x) => x.batchId === id);
    return (items[i + 1] ?? items[i - 1])?.batchId ?? 'heading';
  };
  const restore = async (item: TrashItem) => {
    setError('');
    const r = await client.call('trash.restore', { batchId: item.batchId });
    if (!r.ok) {
      setError(
        r.error.code === 'not_found'
          ? `${quoted(item.label)} is no longer in Trash.`
          : `Couldn’t restore: ${r.error.message}`,
      );
      return void t.reload();
    }
    focusAfter.current = neighbour(item.batchId);
    const msg = await landing(client, item);
    setNotice(msg);
    onRestored?.(item, msg);
  };
  const purge = async (item: TrashItem) => {
    setError('');
    focusAfter.current = neighbour(item.batchId);
    const r = await client.call('trash.purge', { batchId: item.batchId, confirmed: true });
    setAsking(null);
    if (r.ok) setNotice(`Permanently deleted ${quoted(item.label)}.`);
    else setError(`Couldn’t delete: ${r.error.message}`);
    void t.reload();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const id = target.closest<HTMLElement>('[data-batch]')?.dataset.batch;
    const i = items.findIndex((x) => x.batchId === id);
    if (i < 0) return;
    const go = (to: TrashItem | undefined) => {
      if (!to) return;
      setActive(to.batchId);
      listRef.current?.querySelector<HTMLElement>(`[data-batch="${to.batchId}"]`)?.focus();
    };
    if (e.key === 'ArrowDown') go(items[Math.min(items.length - 1, i + 1)]);
    else if (e.key === 'ArrowUp') go(items[Math.max(0, i - 1)]);
    else if (e.key === 'Home') go(items[0]);
    else if (e.key === 'End') go(items[items.length - 1]);
    else if (e.key === 'Enter' && target.tagName === 'LI') void restore(items[i]!);
    else if (e.key === 'Delete') setAsking(items[i]!);
    else return;
    e.preventDefault();
  };

  return (
    <section aria-labelledby="trash-h">
      <h2 id="trash-h" ref={headingRef} tabIndex={-1}>
        Trash
      </h2>
      <div role="status" className="muted">
        {notice}
      </div>
      {error && <p role="alert">{error}</p>}
      {t.status === 'loading' ? (
        <p className="pane-msg muted">Loading Trash…</p>
      ) : t.status === 'error' ? (
        <div className="pane-msg" role="alert">
          <p>Couldn’t load Trash: {t.error}</p>
          <button type="button" onClick={() => void t.reload()}>
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="pane-msg">
          <p>Trash is empty. Deleted notes and folders wait here until you remove them.</p>
          {onBack && (
            <button type="button" onClick={onBack}>
              Back to all notes
            </button>
          )}
        </div>
      ) : (
        <ul ref={listRef} aria-label="Deleted items" onKeyDown={onKeyDown}>
          {items.map((it) => (
            <li
              key={it.batchId}
              data-batch={it.batchId}
              tabIndex={it.batchId === activeId ? 0 : -1}
              onFocus={() => setActive(it.batchId)}
            >
              <span>{it.label || 'Untitled'}</span>{' '}
              <span className="muted">
                {it.entity === 'folder' ? 'Folder' : 'Note'}, deleted{' '}
                {new Date(it.trashedAt).toLocaleDateString()}
              </span>
              {it.entity === 'note' && onOpenNote && (
                <button
                  type="button"
                  aria-label={`Open ${quoted(it.label)} (read-only)`}
                  onClick={() => onOpenNote(it.id)}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                aria-label={`Restore ${quoted(it.label)}`}
                onClick={() => void restore(it)}
              >
                Restore
              </button>
              <button
                type="button"
                aria-label={`Delete ${quoted(it.label)} permanently`}
                onClick={() => setAsking(it)}
              >
                Delete permanently…
              </button>
            </li>
          ))}
        </ul>
      )}
      {asking && (
        <ConfirmDialog
          title={`Delete ${quoted(asking.label)} permanently?`}
          description={`Permanently delete ${quoted(asking.label)}? This cannot be undone.`}
          confirmLabel="Delete permanently"
          onCancel={() => setAsking(null)}
          onConfirm={() => purge(asking)}
        />
      )}
    </section>
  );
}
