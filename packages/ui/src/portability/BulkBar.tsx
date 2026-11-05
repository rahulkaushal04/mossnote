import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../app/context';
import { useStore } from '../app/store';
import { useModal } from '../dialog/useModal';
import { flattenFolders } from '../nav/folderRows';
import { useLoad } from '../nav/useLoad';
import type { Client } from '../rpc/client';
import { MAX_BULK_SELECT, plural } from './summary';
import './portability.css';

/**
 * Select toggle, or (while selecting) the count and the bulk actions. Rendered by the note list and
 * the search results; `order` is the ids in view, in display order. Actions run the same commands
 * as the palette, so there is one code path.
 */
export function BulkBar({ order }: { order: string[] }) {
  const { model, registry } = useApp();
  const sel = model.selection;
  const on = useStore(sel, (s) => s.on);
  const ids = useStore(sel, (s) => s.ids);
  const capped = useStore(sel, (s) => s.capped);
  const doneRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const countId = useId();

  useEffect(() => {
    sel.hooks.visible = () => orderRef.current;
    sel.hooks.focus = () => (doneRef.current ?? toggleRef.current)?.focus();
    return () => {
      sel.hooks.visible = undefined;
      sel.hooks.focus = undefined;
    };
  }, [sel]);
  // Only notes in view can be acted on; a changed view drops the rest.
  useEffect(() => {
    if (on) sel.prune(order);
  }, [on, order, sel]);

  if (!on)
    return (
      <button type="button" ref={toggleRef} onClick={() => sel.enter()}>
        Select notes
      </button>
    );
  const n = ids.size;
  const run = (id: string) => () => void registry.run(id);
  return (
    <div className="bulkbar" role="group" aria-label="Bulk actions">
      <span id={countId} className="bulkbar-count" role="status">
        {n === 0 ? 'No notes selected' : `${plural(n, 'note')} selected`}
        {capped ? ` (limit of ${MAX_BULK_SELECT.toLocaleString('en-US')} reached)` : ''}
      </span>
      <button type="button" onClick={() => sel.selectAll(order)}>
        Select all in view
      </button>
      <button type="button" disabled={n === 0} onClick={run('bulk.move')}>
        Move to…
      </button>
      <button type="button" disabled={n === 0} onClick={run('bulk.tag')}>
        Tag…
      </button>
      <button type="button" disabled={n === 0} onClick={run('bulk.untag')}>
        Untag…
      </button>
      <button type="button" disabled={n === 0} onClick={run('bulk.trash')}>
        Move to Trash
      </button>
      <button type="button" disabled={n === 0} onClick={run('bulk.export')}>
        Export selection…
      </button>
      <button type="button" ref={doneRef} onClick={() => sel.exit()}>
        Done
      </button>
    </div>
  );
}

export interface BulkMoveDialogProps {
  client: Client;
  count: number;
  onSubmit(folderId: string | null, label: string): void | Promise<void>;
  onCancel(): void;
}
/** The MoveToDialog pattern (destination select, Move / Cancel) for many notes. */
export function BulkMoveDialog({ client, count, onSubmit, onCancel }: BulkMoveDialogProps) {
  const folders = useLoad(client, () => client.call('folders.list'), ['folder']);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const { ref, onKeyDown } = useModal(onCancel, selectRef);
  const options = useMemo(() => flattenFolders(folders.data ?? [], () => true), [folders.data]);
  const go = async () => {
    setBusy(true);
    const f = options.find((o) => o.folder.id === dest);
    await onSubmit(dest === '' ? null : dest, f ? f.folder.name : 'No folder');
  };
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{`Move ${plural(count, 'note')} to…`}</h2>
        <label>
          Destination{' '}
          <select ref={selectRef} value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="">No folder</option>
            {options.map((o) => (
              <option key={o.folder.id} value={o.folder.id}>
                {' '.repeat(o.level - 1) + o.folder.name}
              </option>
            ))}
          </select>
        </label>
        {folders.status === 'error' && <p role="alert">{folders.error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={() => void go()}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}

export interface BulkTagDialogProps {
  client: Client;
  count: number;
  /** true: add the tag; false: remove it. */
  on: boolean;
  onSubmit(tagId: string, name: string): void | Promise<void>;
  onCancel(): void;
}
export function BulkTagDialog({ client, count, on, onSubmit, onCancel }: BulkTagDialogProps) {
  const tags = useLoad(client, () => client.call('tags.list'), ['tag']);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [tagId, setTagId] = useState('');
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const { ref, onKeyDown } = useModal(onCancel, selectRef);
  const list = tags.data ?? [];
  const chosen = list.find((t) => t.id === (tagId || list[0]?.id));
  const go = async () => {
    if (!chosen) return;
    setBusy(true);
    await onSubmit(chosen.id, chosen.name);
  };
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{`${on ? 'Tag' : 'Untag'} ${plural(count, 'note')}`}</h2>
        {tags.status === 'ready' && list.length === 0 ? (
          <p>There are no tags yet. Add a tag to a note first.</p>
        ) : (
          <label>
            Tag{' '}
            <select
              ref={selectRef}
              value={chosen?.id ?? ''}
              onChange={(e) => setTagId(e.target.value)}
            >
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {tags.status === 'error' && <p role="alert">{tags.error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={busy || !chosen} onClick={() => void go()}>
            {on ? 'Tag' : 'Untag'}
          </button>
        </div>
      </div>
    </div>
  );
}
