import { getMeta, setMeta } from '../db/meta.ts';
import type { Workspace } from '../workspace.ts';
import { err, ok, type Result } from '../result.ts';
import { deriveTitle } from './title.ts';

const KEY = 'inbox_folder_id';

/** The Inbox folder id; created once, reused, recreated if trashed or deleted. */
function ensureInbox(ws: Workspace): Result<{ id: string; created: boolean }> {
  const cur = getMeta(ws.store.db, KEY);
  if (cur) {
    const f = ws.folders.get(cur);
    if (f.ok && !f.value.trashed) return ok({ id: cur, created: false });
  }
  // Crash-safe: a folder created before a lost meta write is adopted, not duplicated.
  const all = ws.folders.list();
  if (!all.ok) return all;
  const existing = all.value.find((x) => x.name === 'Inbox' && x.parentId === null && !x.trashed);
  const f = existing ? ok(existing) : ws.folders.create({}, { name: 'Inbox' });
  if (!f.ok) return f;
  const m = ws.store.mutate({}, (tx) => {
    setMeta(tx.db, KEY, f.value.id);
    return ok(undefined);
  });
  return m.ok ? ok({ id: f.value.id, created: !existing }) : m;
}

export function captureSave(
  ws: Workspace,
  text: string,
): Result<{ noteId: string; inboxCreated: boolean; inboxId: string }> {
  const inbox = ensureInbox(ws);
  if (!inbox.ok) return inbox;
  const n = ws.notes.create({}, { title: deriveTitle(text), body: text, folderId: inbox.value.id });
  if (!n.ok) return n.error.code === 'not_found' ? err('internal', 'inbox unavailable') : n;
  return ok({ noteId: n.value.id, inboxCreated: inbox.value.created, inboxId: inbox.value.id });
}
