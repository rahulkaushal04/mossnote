import type { Client } from '../rpc/client';
import type { ToastStore } from '../toast/toastStore';
import type { SelectionStore } from './selection';
import { plural } from './summary';

export interface BulkDeps {
  client: Client;
  toasts: ToastStore;
  selection: SelectionStore;
  /** Awaited before a trash, e.g. flush the editor's pending save. */
  beforeTrash?(): void | Promise<void>;
  /** After a successful trash, e.g. close the editor when its note is among them. */
  onTrashed?(ids: string[]): void;
}
export interface BulkActions {
  trash(ids: string[]): Promise<boolean>;
  move(ids: string[], folderId: string | null, label: string): Promise<boolean>;
  tag(ids: string[], tagId: string, on: boolean, tagName: string): Promise<boolean>;
  exportNotes(ids: string[]): Promise<boolean>;
}

/**
 * Each action is ONE core call (all or nothing) and ONE Undo toast whose action is the matching
 * inverse call. Undo of move/tag passes `undo: true`, so items that changed meanwhile are skipped and counted.
 */
export function createBulkActions(d: BulkDeps): BulkActions {
  const { client, toasts, selection } = d;
  const fail = (what: string, message: string) => {
    toasts.push({ message: `Couldn’t ${what}: ${message}`, lifetimeMs: 15_000 });
    return false;
  };
  const done = () => {
    selection.clear();
    selection.hooks.focus?.();
    return true;
  };
  const skippedText = (n: number, why: string) => (n > 0 ? ` ${n} skipped because ${why}.` : '');

  return {
    async trash(ids) {
      await d.beforeTrash?.();
      const r = await client.call('bulk.trash', { ids });
      if (!r.ok) return fail('move to Trash', r.error.message);
      const { batchIds } = r.value;
      d.onTrashed?.(ids);
      toasts.push({
        message: `Moved ${plural(ids.length, 'note')} to Trash.`,
        actionLabel: 'Undo delete',
        onAction: async () => {
          const u = await client.call('bulk.untrash', { batchIds });
          if (!u.ok) return void fail('undo', u.error.message);
          toasts.push({
            message: `Restored ${plural(u.value.restored, 'note')}.${skippedText(u.value.skipped, 'they were already deleted for good')}`,
            lifetimeMs: 6000,
          });
        },
      });
      return done();
    },

    async move(ids, folderId, label) {
      const r = await client.call('bulk.move', { items: ids.map((id) => ({ id, folderId })) });
      if (!r.ok) return fail('move the notes', r.error.message);
      const { previous, skipped } = r.value;
      if (previous.length === 0) {
        toasts.push({
          message: `No notes were moved.${skippedText(skipped.length, 'they changed')}`,
        });
        return done();
      }
      toasts.push({
        message: `Moved ${plural(previous.length, 'note')} to “${label}”.${skippedText(skipped.length, 'they changed')}`,
        actionLabel: 'Undo move',
        onAction: async () => {
          const u = await client.call('bulk.move', { items: previous, undo: true });
          if (!u.ok) return void fail('undo', u.error.message);
          toasts.push({
            message: `Moved ${plural(u.value.previous.length, 'note')} back.${skippedText(u.value.skipped.length, 'they changed since')}`,
            lifetimeMs: 6000,
          });
        },
      });
      return done();
    },

    async tag(ids, tagId, on, tagName) {
      const r = await client.call('bulk.tag', { ids, tagId, on });
      if (!r.ok) return fail(on ? 'tag the notes' : 'remove the tag', r.error.message);
      const { changed, skipped } = r.value;
      if (changed.length === 0) {
        toasts.push({
          message: `No notes needed changes.${skippedText(skipped.length, 'they changed')}`,
        });
        return done();
      }
      toasts.push({
        message: `${
          on
            ? `Tagged ${plural(changed.length, 'note')} with “${tagName}”.`
            : `Removed “${tagName}” from ${plural(changed.length, 'note')}.`
        }${skippedText(skipped.length, 'they changed')}`,
        actionLabel: on ? 'Undo tag' : 'Undo untag',
        onAction: async () => {
          const u = await client.call('bulk.tag', { ids: changed, tagId, on: !on, undo: true });
          if (!u.ok) return void fail('undo', u.error.message);
          toasts.push({
            message: `Undone for ${plural(u.value.changed.length, 'note')}.${skippedText(u.value.skipped.length, 'they changed since')}`,
            lifetimeMs: 6000,
          });
        },
      });
      return done();
    },

    async exportNotes(ids) {
      const r = await client.call('bulk.export', { ids });
      if (!r.ok) return fail('export', r.error.message);
      if ('cancelled' in r.value) {
        toasts.push({ message: 'Export cancelled. Nothing was written.', lifetimeMs: 4000 });
        return false;
      }
      toasts.push({ message: `Exporting ${plural(ids.length, 'note')}…`, lifetimeMs: 4000 });
      return true;
    },
  };
}
