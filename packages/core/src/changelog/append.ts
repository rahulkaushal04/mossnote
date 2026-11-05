import { z } from 'zod';
import { getMeta, setMeta } from '../db/meta.ts';
import type { Db } from '../db/types.ts';
import { formatHlc, tickHlc } from '../ids/hlc.ts';
import { err, ok, type Result } from '../result.ts';

import {
  actorSchema,
  checkRow,
  ENTITIES,
  entityIdSchema,
  OPS,
  purgedSchema,
  sha,
  ulid,
} from './schema.ts';

export { ENTITIES, OPS };
export type { Entity, Op } from './schema.ts';

/** Per-mutation environment, built by the store's mutate(). */
export interface ChangeEnv {
  db: Db;
  deviceId: string;
  schemaVersion: number;
  now: number;
  ulid: () => string;
}

const input = z
  .object({
    entity: z.enum(ENTITIES),
    entityId: entityIdSchema,
    op: z.enum(OPS),
    fields: z.record(z.string(), z.unknown()).default({}),
    actorId: actorSchema.nullish(),
    noteVersionId: ulid.nullish(),
    baseVersionId: ulid.nullish(),
    contentHash: sha.nullish(),
    baseContentHash: sha.nullish(),
    /** Purge only: every id removed, captured at purge time. Defaults to [entityId]. */
    purged: purgedSchema.optional(),
    mergedInto: ulid.nullish(),
  })
  .strict()
  .superRefine((v, c) => {
    checkRow({ ...v, purgedIds: v.purged }, c);
    if (v.mergedInto && !(v.op === 'purge' && v.entity === 'tag'))
      c.addIssue({ code: 'custom', message: 'mergedInto only on tag purge' });
  });
export type ChangeInput = z.input<typeof input>;

/** The only writer of change_log for local actions. Must run inside the caller's transaction. */
export function appendChange(env: ChangeEnv, raw: ChangeInput): Result<string> {
  const p = input.safeParse(raw);
  if (!p.success) return err('validation', p.error.message, p.error);
  const c = p.data;
  const { db } = env;

  const last = {
    ms: Number(getMeta(db, 'hlc_ms') ?? 0),
    counter: Number(getMeta(db, 'hlc_counter') ?? 0),
  };
  const h = tickHlc(last, env.now);
  setMeta(db, 'hlc_ms', String(h.ms));
  setMeta(db, 'hlc_counter', String(h.counter));

  const { next } = db
    .prepare('SELECT coalesce(max(seq), 0) + 1 AS next FROM change_log WHERE device_id = ?')
    .get(env.deviceId) as { next: number };

  const purged = c.op === 'purge' ? (c.purged ?? [{ entity: c.entity, id: c.entityId }]) : null;
  const id = env.ulid();
  db.prepare(
    `INSERT INTO change_log(id, entity, entity_id, op, hlc, device_id, seq, origin, actor_id,
       schema_version, fields, note_version_id, base_version_id, content_hash, base_content_hash,
       purged_ids, merged_into, created_at)
     VALUES (?,?,?,?,?,?,?, 'local', ?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    c.entity,
    c.entityId,
    c.op,
    formatHlc(h),
    env.deviceId,
    next,
    c.actorId ?? null,
    env.schemaVersion,
    JSON.stringify(c.fields),
    c.noteVersionId ?? null,
    c.baseVersionId ?? null,
    c.contentHash ?? null,
    c.baseContentHash ?? null,
    purged ? JSON.stringify(purged) : null,
    c.mergedInto ?? null,
    env.now,
  );
  if (purged) addTombstones(db, purged, id, env.now, c.mergedInto ?? null);
  return ok(id);
}

/** Idempotent: a second purge of the same id keeps the first tombstone, but may fill in a missing entity. */
export function addTombstones(
  db: Db,
  purged: readonly { entity: string | null; id: string }[],
  changeId: string,
  now: number,
  mergedInto: string | null,
): void {
  const stmt = db.prepare(
    `INSERT INTO tombstones(entity_id, entity, purged_at, change_id, merged_into) VALUES (?,?,?,?,?)
     ON CONFLICT(entity_id) DO UPDATE SET entity = excluded.entity
       WHERE tombstones.entity IS NULL AND excluded.entity IS NOT NULL`,
  );
  for (const x of purged) stmt.run(x.id, x.entity, now, changeId, mergedInto);
}

const REDACT_CHUNK = 1000;

/** The documented redaction on purge: nulls `fields` of earlier rows for purged entities, nothing else.
 *  Also covers their note_tag rows (this relies on note_tag rows carrying only `{present}` in fields,
 *  so nulling them loses nothing but that flag) (entity_id `noteId:tagId`) by exact id range, never a LIKE scan. */
export function redactFields(db: Db, entityIds: readonly string[]): void {
  const byId = db.prepare(
    'UPDATE change_log SET fields = NULL WHERE entity_id IN (SELECT value FROM json_each(?))',
  );
  for (let i = 0; i < entityIds.length; i += REDACT_CHUNK)
    byId.run(JSON.stringify(entityIds.slice(i, i + REDACT_CHUNK)));
  // ':' + 1 = ';': every entity_id starting with `${id}:` lies in [`${id}:`, `${id};`)
  const links = db.prepare(
    "UPDATE change_log SET fields = NULL WHERE entity = 'note_tag' AND entity_id >= ? AND entity_id < ?",
  );
  for (const id of entityIds) links.run(`${id}:`, `${id};`);
}
