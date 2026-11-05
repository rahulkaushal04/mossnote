import { z } from 'zod';
import { getMeta } from '../db/meta.ts';
import { err, ok, type Result } from '../result.ts';
import type { Ctx, Store } from '../store/store.ts';
import { DAY_MS, noteIsTrashed, parse, safe } from '../trash/derive.ts';
import { insertVersion, snapshotNote, THIN_AFTER_DAYS } from './snapshot.ts';

export interface VersionSummary {
  id: string;
  noteId: string;
  title: string;
  contentHash: string;
  size: number;
  reason: string;
  parentVersionId: string | null;
  createdAt: number;
  actorId: string | null;
}
export interface Version extends VersionSummary {
  body: string;
}
const omitBody = (v: Version): VersionSummary => {
  const s: Partial<Version> = { ...v };
  delete s.body;
  return s as VersionSummary;
};

interface Row {
  id: string;
  note_id: string;
  title: string;
  body: string;
  content_hash: string;
  reason: string;
  parent_version_id: string | null;
  created_at: number;
  actor_id: string | null;
}
const toVersion = (r: Row): Version => ({
  id: r.id,
  noteId: r.note_id,
  title: r.title,
  body: r.body,
  contentHash: r.content_hash,
  size: r.body.length,
  reason: r.reason,
  parentVersionId: r.parent_version_id,
  createdAt: r.created_at,
  actorId: r.actor_id,
});

const id = z.string().min(1).max(64);

export function createVersionsApi(s: Store) {
  return {
    /** Newest first. Bodies are omitted; use get() for text. */
    list(noteId: string): Result<VersionSummary[]> {
      const p = parse(id, noteId);
      if (!p.ok) return p;
      return safe(() => {
        // length() is computed by SQLite: bodies (up to 10 MB each) are never loaded for a list.
        const rows = s.db
          .prepare(
            `SELECT id, note_id, title, '' AS body, length(body) AS size, content_hash, reason,
               parent_version_id, created_at, actor_id
             FROM versions WHERE note_id = ? ORDER BY created_at DESC, id DESC`,
          )
          .all(noteId) as (Row & { size: number })[];
        return ok(rows.map((r) => ({ ...omitBody(toVersion(r)), size: r.size })));
      });
    },

    get(versionId: string): Result<Version> {
      const p = parse(id, versionId);
      if (!p.ok) return p;
      return safe(() => {
        const r = s.db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId) as
          Row | undefined;
        return r ? ok(toVersion(r)) : err('not_found', 'version not found');
      });
    },

    /**
     * Writes the old text as a NEW head (reason 'restore', parent = restored id); the old version
     * is kept. First snapshots the current text (reason 'pre_restore') unless the head already
     * holds exactly it, so no un-versioned edit is lost. One change-log row.
     */
    restore(ctx: Ctx, versionId: string): Result<{ versionId: string; contentHash: string }> {
      const p = parse(id, versionId);
      if (!p.ok) return p;
      return s.mutate(ctx, (tx) => {
        const v = tx.db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId) as
          Row | undefined;
        if (!v) return err('not_found', 'version not found');
        const n = tx.db
          .prepare(
            'SELECT id, folder_id, trashed_at, content_hash, head_version_id FROM notes WHERE id = ?',
          )
          .get(v.note_id) as
          | {
              id: string;
              folder_id: string | null;
              trashed_at: number | null;
              content_hash: string;
              head_version_id: string | null;
            }
          | undefined;
        if (!n) return err('not_found', 'note not found');
        if (noteIsTrashed(tx.db, n)) return err('conflict', 'note is in the trash');
        const cas = tx.checkExpected(n.content_hash);
        if (!cas.ok) return cas;
        const snap = snapshotNote(tx, n.id, 'pre_restore');
        if (!snap.ok) return snap;
        const baseVersionId = snap.value; // holds exactly the text hashed as baseContentHash
        tx.db
          .prepare(
            `UPDATE notes SET title = ?, body = ?, content_hash = ?, rev = rev + 1, updated_at = ?
             WHERE id = ?`,
          )
          .run(v.title, v.body, v.content_hash, tx.now, n.id);
        const nv = insertVersion(
          tx,
          { id: n.id, head_version_id: snap.value },
          { title: v.title, body: v.body, hash: v.content_hash },
          'restore',
          v.id,
        );
        const l = tx.log({
          entity: 'note',
          entityId: n.id,
          op: 'update',
          fields: { title: v.title, restoredFrom: v.id },
          noteVersionId: nv,
          baseVersionId,
          contentHash: v.content_hash,
          baseContentHash: n.content_hash,
        });
        return l.ok ? ok({ versionId: nv, contentHash: v.content_hash }) : l;
      });
    },

    /**
     * Snapshot of the current text regardless of throttling (sync calls this before applying remote
     * changes, and when a merge base is needed). `merge_base` also records a hold for `peerId`.
     * Not a user action: no change-log row. Inside an applyRemote callback use snapshotNote(tx, ...).
     */
    force(noteId: string, reason: 'remote' | 'merge_base', peerId?: string): Result<string> {
      const v = parse(z.tuple([id, z.enum(['remote', 'merge_base'])]), [noteId, reason]);
      if (!v.ok) return v;
      if (reason === 'merge_base' && !peerId) return err('validation', 'merge_base needs a peerId');
      if (peerId !== undefined) {
        const pv = parse(id, peerId);
        if (!pv.ok) return pv;
      }
      return s.mutate({}, (tx) => {
        const r = snapshotNote(tx, noteId, reason);
        if (r.ok && reason === 'merge_base')
          tx.db
            .prepare(
              'INSERT OR IGNORE INTO base_holds(peer_id, version_id, created_at) VALUES (?,?,?)',
            )
            .run(peerId, r.value, tx.now);
        return r;
      });
    },

    hold(peerId: string, versionId: string): Result<void> {
      const p = parse(z.tuple([id, id]), [peerId, versionId]);
      if (!p.ok) return p;
      return s.mutate({}, (tx) => {
        if (!tx.db.prepare('SELECT 1 AS x FROM versions WHERE id = ?').get(versionId))
          return err('not_found', 'version not found');
        tx.db
          .prepare(
            'INSERT OR IGNORE INTO base_holds(peer_id, version_id, created_at) VALUES (?,?,?)',
          )
          .run(peerId, versionId, tx.now);
        return ok(undefined);
      });
    },

    release(peerId: string, versionId: string): Result<void> {
      const p = parse(z.tuple([id, id]), [peerId, versionId]);
      if (!p.ok) return p;
      return s.mutate({}, (tx) => {
        tx.db
          .prepare('DELETE FROM base_holds WHERE peer_id = ? AND version_id = ?')
          .run(peerId, versionId);
        return ok(undefined);
      });
    },

    /**
     * Versions older than 30 days thin to the latest per (note, UTC day). Never deleted: a note's
     * head, any held version, and (when meta `sync_oldest_ack_hlc` exists; '' = a peer has acked
     * nothing) any version referenced (as note or base version) by a change-log row with hlc greater than that value.
     * Absent key = no sync peers. Not logged.
     */
    prune(): Result<{ deleted: number }> {
      return s.mutate({}, (tx) => {
        const cutoff = tx.now - THIN_AFTER_DAYS * DAY_MS;
        const old = tx.db
          .prepare(
            'SELECT id, note_id, created_at FROM versions WHERE created_at < ? ORDER BY created_at, id',
          )
          .all(cutoff) as { id: string; note_id: string; created_at: number }[];
        const keep = new Map<string, string>(); // note|day -> latest id (rows ascend)
        for (const v of old) keep.set(`${v.note_id}|${Math.floor(v.created_at / DAY_MS)}`, v.id);
        const protectedIds = new Set<string>(keep.values());
        const add = (sql: string, ...a: unknown[]) => {
          for (const r of tx.db.prepare(sql).all(...a) as { v: string | null }[])
            if (r.v) protectedIds.add(r.v);
        };
        add('SELECT head_version_id AS v FROM notes');
        add('SELECT version_id AS v FROM base_holds');
        const ack = getMeta(tx.db, 'sync_oldest_ack_hlc');
        if (ack !== undefined)
          add(
            `SELECT note_version_id AS v FROM change_log WHERE note_version_id IS NOT NULL AND hlc > ?
             UNION SELECT base_version_id FROM change_log WHERE base_version_id IS NOT NULL AND hlc > ?`,
            ack,
            ack,
          );
        const del = tx.db.prepare('DELETE FROM versions WHERE id = ?');
        let deleted = 0;
        for (const v of old) if (!protectedIds.has(v.id)) deleted += del.run(v.id).changes;
        return ok({ deleted });
      });
    },
  };
}
export type VersionsApi = ReturnType<typeof createVersionsApi>;
