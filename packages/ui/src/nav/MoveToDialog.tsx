import { useId, useMemo, useRef, useState } from 'react';
import { useModal } from '../dialog/useModal';
import type { Client } from '../rpc/client';
import { flattenFolders } from './folderRows';
import { useLoad } from './useLoad';

export interface MoveToDialogProps {
  client: Client;
  entity: 'folder' | 'note';
  id: string;
  /** The item's name, shown in the heading. */
  label: string;
  /** Preselects the item's current location. */
  currentFolderId?: string | null;
  /** `moved` is true after a successful move; render this only while it is open. */
  onClose(moved: boolean): void;
}

/**
 * The drag-free "Move to…" command for a folder or a note. A folder cannot be moved into itself
 * or its own subtree (those are not offered); core rejects any other invalid target.
 */
export function MoveToDialog({
  client,
  entity,
  id,
  label,
  currentFolderId,
  onClose,
}: MoveToDialogProps) {
  const folders = useLoad(client, () => client.call('folders.list'), ['folder']);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [dest, setDest] = useState<string>(currentFolderId ?? '');
  const [err, setErr] = useState('');
  const titleId = useId();
  const { ref, onKeyDown } = useModal(() => onClose(false), selectRef);
  const options = useMemo(
    () => flattenFolders(folders.data ?? [], () => true, entity === 'folder' ? id : undefined),
    [folders.data, entity, id],
  );
  const move = async () => {
    const to = dest === '' ? null : dest;
    const r =
      entity === 'folder'
        ? await client.call('folders.move', { id, parentId: to })
        : await client.call('notes.move', { id, folderId: to });
    if (r.ok) onClose(true);
    else setErr(r.error.message);
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
        <h2 id={titleId}>{`Move "${label}" to…`}</h2>
        <label>
          Destination{' '}
          <select ref={selectRef} value={dest} onChange={(e) => setDest(e.target.value)}>
            <option value="">{entity === 'note' ? 'No folder' : 'Top level'}</option>
            {options.map((o) => (
              <option key={o.folder.id} value={o.folder.id}>
                {' '.repeat(o.level - 1) + o.folder.name}
              </option>
            ))}
          </select>
        </label>
        {folders.status === 'error' && <p role="alert">{folders.error}</p>}
        {err && <p role="alert">{err}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="button" onClick={() => void move()}>
            Move
          </button>
        </div>
      </div>
    </div>
  );
}
