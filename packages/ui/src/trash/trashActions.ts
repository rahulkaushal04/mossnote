import type { Client } from '../rpc/client';
import type { ToastStore } from '../toast/toastStore';

export type TrashEntity = 'note' | 'folder';
export interface TrashActionsDeps {
  client: Client;
  toasts: ToastStore;
  /** Awaited before the RPC, e.g. flush the editor's pending save of that note. */
  beforeTrash?(entity: TrashEntity, id: string): void | Promise<void>;
  /** After a successful trash, e.g. close the editor if that note is open. */
  onTrashed?(entity: TrashEntity, id: string, batchId: string): void;
  /** After a successful Undo. */
  onRestored?(entity: TrashEntity, id: string): void;
}
export type DeleteResult = { ok: true; batchId: string } | { ok: false; message: string };
export interface TrashActions {
  /** `label` is the name shown in the toast; when omitted it is read back from `trash.list`. */
  deleteNote(id: string, label?: string): Promise<DeleteResult>;
  deleteFolder(id: string, label?: string): Promise<DeleteResult>;
}

/**
 * Delete = move to Trash + an "Undo delete" toast (10 s). Lists refresh from the `changed` events
 * the RPC emits, not from here. Undo restores the whole batch (a folder with its contents).
 */
export function createTrashActions(d: TrashActionsDeps): TrashActions {
  const run = async (entity: TrashEntity, id: string, label?: string): Promise<DeleteResult> => {
    await d.beforeTrash?.(entity, id);
    const r =
      entity === 'note'
        ? await d.client.call('notes.trash', { id })
        : await d.client.call('folders.trash', { id });
    if (!r.ok) {
      const message = `Couldn’t move to Trash: ${r.error.message}`;
      d.toasts.push({ message });
      return { ok: false, message };
    }
    const { batchId } = r.value;
    let name = label;
    if (name === undefined) {
      const l = await d.client.call('trash.list');
      name = (l.ok && l.value.find((i) => i.batchId === batchId)?.label) || 'item';
    }
    d.onTrashed?.(entity, id, batchId);
    d.toasts.push({
      message: `Moved "${name}" to Trash.`,
      actionLabel: 'Undo delete',
      onAction: async () => {
        const u = await d.client.call('trash.restore', { batchId });
        if (u.ok) {
          d.onRestored?.(entity, id);
          d.toasts.push({ message: `Restored "${name}".`, lifetimeMs: 4000 });
        } else {
          d.toasts.push({
            message:
              u.error.code === 'not_found'
                ? `"${name}" was already deleted permanently.`
                : `Couldn’t undo: ${u.error.message}`,
          });
        }
      },
    });
    return { ok: true, batchId };
  };
  return {
    deleteNote: (id, label) => run('note', id, label),
    deleteFolder: (id, label) => run('folder', id, label),
  };
}
