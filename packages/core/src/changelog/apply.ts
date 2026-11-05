import { z } from 'zod';
import { getMeta, setMeta } from '../db/meta.ts';
import type { Db } from '../db/types.ts';
import { err, ok, type Result } from '../result.ts';
import { addTombstones, redactFields } from './append.ts';
import {
  actorSchema,
  checkRow,
  ENTITIES,
  entityIdSchema,
  hlcText,
  MAX_FIELDS_BYTES,
  OPS,
  purgedSchema,
  sha,
  ulid,
} from './schema.ts';

export const MAX_REMOTE_FIELDS_BYTES = MAX_FIELDS_BYTES;
/** A remote HLC further ahead of this store's clock than this is refused: merging it would drag every
 *  later local HLC to the far future. */
export const MAX_CLOCK_SKEW_MS = 60 * 60 * 1000;

const remote = z
  .object({
    id: ulid,
    entity: z.enum(ENTITIES),
    entityId: entityIdSchema,
    op: z.enum(OPS),
    hlc: hlcText,
    deviceId: ulid,
    seq: z.number().int().min(1),
    actorId: actorSchema.nullish(),
    schemaVersion: z.number().int().min(1),
    fields: z.record(z.string(), z.unknown()).nullable(),
    noteVersionId: ulid.nullish(),
    baseVersionId: ulid.nullish(),
    contentHash: sha.nullish(),
    baseContentHash: sha.nullish(),
    purgedIds: purgedSchema.nullish(),
    mergedInto: ulid.nullish(),
    createdAt: z.number().int(),
  })
  .strict()
  .superRefine(checkRow);
export type RemoteChange = z.input<typeof remote>;

export interface ApplyRemoteOptions {
  /** Record the row (advancing the device's sequence) without running `applyEntity`.
   *  Sync (T42) needs a quarantine-and-skip path: a row whose entity effect permanently fails would
   *  otherwise wedge that device's stream at its seq (rows must arrive in order). T42 quarantines the
   *  row's payload elsewhere and calls this with recordOnly so the following rows can apply. */
  recordOnly?: boolean;
}

const SAME_COLS =
  'id, entity, entity_id, op, hlc, actor_id, schema_version, note_version_id, base_version_id, content_hash, base_content_hash, purged_ids, merged_into, created_at';

/** Receive rule of a hybrid logical clock: local := max(local, remote), no seq, no row. */
function mergeRemoteHlc(db: Db, hlc: string): void {
  const [rms, rc] = hlc.split('-').map(Number) as [number, number];
  const ms = Number(getMeta(db, 'hlc_ms') ?? 0);
  const counter = Number(getMeta(db, 'hlc_counter') ?? 0);
  if (rms > ms || (rms === ms && rc > counter)) {
    setMeta(db, 'hlc_ms', String(rms));
    setMeta(db, 'hlc_counter', String(rc));
  }
}

/** Records a change that originated on another device, verbatim (its device_id, seq, hlc).
 *  Never allocates a local seq, so it cannot be re-sent as a local change (no echo); it does advance
 *  the local HLC to at least the remote one so a later local edit sorts after it.
 *  `applyEntity` writes the entity-level effect inside the same transaction. Runs inside the caller's tx.
 *  A device's rows must arrive in order (sync pages by seq): the first is seq 1 and each next is last+1,
 *  otherwise `conflict` ("sequence gap"). Returns false when the identical (device_id, seq) was already
 *  applied (idempotent); the same (device_id, seq) with a different payload is `conflict` ("sequence reuse"). */
export function applyRemoteChange(
  db: Db,
  ownDeviceId: string,
  raw: RemoteChange,
  now: number,
  applyEntity?: () => Result<void>,
  opts: ApplyRemoteOptions = {},
): Result<boolean> {
  const p = remote.safeParse(raw);
  if (!p.success) return err('validation', p.error.message, p.error);
  const c = p.data;
  if (c.deviceId === ownDeviceId) return err('validation', 'remote change carries this device id');
  const [hms] = c.hlc.split('-').map(Number) as [number];
  if (hms > now + MAX_CLOCK_SKEW_MS)
    return err('validation', `remote hlc is too far in the future (clock too far ahead): ${c.hlc}`);
  const purged = c.op === 'purge' ? (c.purgedIds ?? [{ entity: c.entity, id: c.entityId }]) : null;
  const purgedJson = purged && c.purgedIds ? JSON.stringify(c.purgedIds) : null;

  // Own-device rows are refused above, so sync must filter its own device out of what it requests (T42).
  // The reuse comparison below deliberately ignores `fields`: a purge redacts them on one replica only.
  const seen = db
    .prepare(`SELECT ${SAME_COLS} FROM change_log WHERE device_id = ? AND seq = ?`)
    .get(c.deviceId, c.seq) as Record<string, unknown> | undefined;
  if (seen) {
    const same =
      seen.id === c.id &&
      seen.entity === c.entity &&
      seen.entity_id === c.entityId &&
      seen.op === c.op &&
      seen.hlc === c.hlc &&
      seen.actor_id === (c.actorId ?? null) &&
      seen.schema_version === c.schemaVersion &&
      seen.note_version_id === (c.noteVersionId ?? null) &&
      seen.base_version_id === (c.baseVersionId ?? null) &&
      seen.content_hash === (c.contentHash ?? null) &&
      seen.base_content_hash === (c.baseContentHash ?? null) &&
      seen.purged_ids === purgedJson &&
      seen.merged_into === (c.mergedInto ?? null) &&
      seen.created_at === c.createdAt;
    return same
      ? ok(false)
      : err(
          'conflict',
          `sequence reuse: ${c.deviceId} seq ${c.seq} arrived with a different payload`,
        );
  }
  const last = (
    db
      .prepare('SELECT coalesce(max(seq), 0) AS m FROM change_log WHERE device_id = ?')
      .get(c.deviceId) as { m: number }
  ).m;
  if (c.seq !== last + 1)
    return err('conflict', `sequence gap: ${c.deviceId} expected seq ${last + 1}, got ${c.seq}`);
  if (last > 0) {
    // A device's own HLC only rises; a relayed row that goes back would be paged out of order by readers.
    const prev = db
      .prepare('SELECT hlc FROM change_log WHERE device_id = ? AND seq = ?')
      .get(c.deviceId, last) as { hlc: string };
    if (c.hlc <= prev.hlc)
      return err(
        'conflict',
        `hlc not increasing: ${c.deviceId} seq ${c.seq} has ${c.hlc} <= ${prev.hlc}`,
      );
  }
  if (db.prepare('SELECT 1 FROM change_log WHERE id = ?').get(c.id))
    return err('conflict', `duplicate change id ${c.id} under another device/seq`);

  if (applyEntity && !opts.recordOnly) {
    const r = applyEntity();
    if (!r.ok) return r;
  }
  // Before the insert so the purge row itself keeps its (empty) fields, like a local purge.
  if (purged)
    redactFields(
      db,
      purged.map((x) => x.id),
    );
  db.prepare(
    `INSERT INTO change_log(id, entity, entity_id, op, hlc, device_id, seq, origin, actor_id,
       schema_version, fields, note_version_id, base_version_id, content_hash, base_content_hash,
       purged_ids, merged_into, created_at)
     VALUES (?,?,?,?,?,?,?, 'remote', ?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    c.id,
    c.entity,
    c.entityId,
    c.op,
    c.hlc,
    c.deviceId,
    c.seq,
    c.actorId ?? null,
    c.schemaVersion,
    c.fields ? JSON.stringify(c.fields) : null,
    c.noteVersionId ?? null,
    c.baseVersionId ?? null,
    c.contentHash ?? null,
    c.baseContentHash ?? null,
    purgedJson,
    c.mergedInto ?? null,
    c.createdAt,
  );
  if (purged) addTombstones(db, purged, c.id, now, c.mergedInto ?? null);
  mergeRemoteHlc(db, c.hlc);
  return ok(true);
}
