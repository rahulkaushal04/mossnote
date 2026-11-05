import { z } from 'zod';
import type { Db } from '../db/types.ts';
import { err, ok, type Result } from '../result.ts';
import type { Entity, Op } from './append.ts';

export interface ChangeRow {
  id: string;
  entity: Entity;
  entityId: string;
  op: Op;
  hlc: string;
  deviceId: string;
  seq: number;
  origin: 'local' | 'remote';
  actorId: string | null;
  schemaVersion: number;
  /** null once redacted by a purge. */
  fields: Record<string, unknown> | null;
  noteVersionId: string | null;
  baseVersionId: string | null;
  contentHash: string | null;
  baseContentHash: string | null;
  purgedIds: { entity: Entity; id: string }[] | null;
  mergedInto: string | null;
  createdAt: number;
}

interface Raw {
  [k: string]: string | number | null;
}
const parse = (s: unknown) => (typeof s === 'string' ? (JSON.parse(s) as never) : null);

export const toChangeRow = (r: Raw): ChangeRow => ({
  id: r.id as string,
  entity: r.entity as Entity,
  entityId: r.entity_id as string,
  op: r.op as Op,
  hlc: r.hlc as string,
  deviceId: r.device_id as string,
  seq: r.seq as number,
  origin: r.origin as 'local' | 'remote',
  actorId: r.actor_id as string | null,
  schemaVersion: r.schema_version as number,
  fields: parse(r.fields),
  noteVersionId: r.note_version_id as string | null,
  baseVersionId: r.base_version_id as string | null,
  contentHash: r.content_hash as string | null,
  baseContentHash: r.base_content_hash as string | null,
  purgedIds: parse(r.purged_ids),
  mergedInto: r.merged_into as string | null,
  createdAt: r.created_at as number,
});

const query = z.object({
  afterDeviceSeq: z.record(z.string(), z.number().int().min(0)).optional(),
  limit: z.number().int().min(1).max(10_000),
});

/**
 * Rows in (hlc, device_id, seq) order, skipping what the caller already has per device.
 * Reads each device's rows by (device_id, seq) keyset on the unique index, so a page costs
 * O(devices x limit), not a walk from the start of the log. Within a device hlc rises with seq
 * (and applyRemote rejects gaps), so cutting the merged list at `limit` never skips a seq.
 */
export function readChanges(db: Db, q: z.input<typeof query>): Result<ChangeRow[]> {
  const p = query.safeParse(q);
  if (!p.success) return err('validation', p.error.message, p.error);
  const after = p.data.afterDeviceSeq ?? {};
  const devices = db
    .prepare(
      `WITH RECURSIVE d(id) AS (
         SELECT min(device_id) FROM change_log
         UNION ALL SELECT (SELECT min(device_id) FROM change_log WHERE device_id > d.id) FROM d WHERE id IS NOT NULL)
       SELECT id FROM d WHERE id IS NOT NULL`,
    )
    .all() as { id: string }[];
  const page = db.prepare(
    'SELECT * FROM change_log WHERE device_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  );
  // k-way merge of per-device queues: each device's rows leave strictly in seq order even if a legacy
  // row has a lower hlc than its predecessor, so a page cut never skips a seq.
  const queues = devices.map(({ id }) => page.all(id, after[id] ?? 0, p.data.limit) as Raw[]);
  const heads = queues.map(() => 0);
  const rows: Raw[] = [];
  while (rows.length < p.data.limit) {
    let best = -1;
    queues.forEach((q, i) => {
      const r = q[heads[i]!];
      const b = best < 0 ? undefined : queues[best]![heads[best]!];
      const before =
        r &&
        (!b ||
          (cmp(r.hlc as string, b.hlc as string) ||
            cmp(r.device_id as string, b.device_id as string)) < 0);
      if (before) best = i;
    });
    if (best < 0) break;
    rows.push(queues[best]![heads[best]!++]!);
  }
  return ok(rows.map(toChangeRow));
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
