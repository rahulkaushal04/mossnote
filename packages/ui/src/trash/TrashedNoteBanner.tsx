import { useState } from 'react';
import type { Client } from '../rpc/client';

/** A note is read-only exactly when it is trashed (directly or through a trashed folder). */
export const isReadOnlyNote = (n: { trashed: boolean } | null | undefined): boolean => !!n?.trashed;
/** `notes.save` on a trashed note fails with this code: switch the editor to read-only. */
export const isTrashedError = (e: { code: string } | null | undefined): boolean =>
  e?.code === 'trashed';

export interface TrashedNoteBannerProps {
  client: Client;
  noteId: string;
  /** Called after a successful Restore; reload the note and make the editor editable. */
  onRestored(): void;
  /** For a note that is trashed only because its folder is: go to Trash to restore the folder. */
  onOpenTrash?(): void;
}

/**
 * Shown by the editor pane above a read-only trashed note. The pane's contract: when
 * `isReadOnlyNote(note)` (or a save returns `isTrashedError`) call `handle.setReadOnly(true)`,
 * render this banner, and call `setReadOnly(false)` from `onRestored`.
 */
export function TrashedNoteBanner({
  client,
  noteId,
  onRestored,
  onOpenTrash,
}: TrashedNoteBannerProps) {
  const [err, setErr] = useState<string | null>(null);
  const restore = async () => {
    setErr(null);
    const l = await client.call('trash.list');
    if (!l.ok) return setErr(l.error.message);
    const item = l.value.find((i) => i.entity === 'note' && i.id === noteId);
    if (!item) return setErr('This note is in a deleted folder. Restore the folder from Trash.');
    const r = await client.call('trash.restore', { batchId: item.batchId });
    if (r.ok) onRestored();
    else setErr(r.error.message);
  };
  return (
    <div className="banner" role="region" aria-label="Trashed note">
      <p>This note is in the Trash and is read-only.</p>
      <button type="button" onClick={() => void restore()}>
        Restore note
      </button>
      {onOpenTrash && (
        <button type="button" onClick={onOpenTrash}>
          Open Trash
        </button>
      )}
      {err && <p role="alert">{err}</p>}
    </div>
  );
}
