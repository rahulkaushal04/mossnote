import { z } from 'zod';

/** One set of rules for change rows, used by local appendChange AND remote applyRemote: whatever the
 *  local writer accepts a peer may relay, and whatever the receiver refuses can never be produced locally,
 *  so a device stream cannot wedge on a row one side would write and the other reject. */
export const ENTITIES = ['note', 'folder', 'tag', 'note_tag', 'attachment_ref', 'setting'] as const;
export const OPS = ['create', 'update', 'move', 'trash', 'restore', 'purge'] as const;
export type Entity = (typeof ENTITIES)[number];
export type Op = (typeof OPS)[number];

export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const ulid = z.string().regex(ULID_RE);
export const sha = z.string().regex(/^[0-9a-f]{64}$/);
export const hlcText = z.string().regex(/^\d{15}-\d{10}$/);
export const MAX_FIELDS_BYTES = 64 * 1024;
export const MAX_ENTITY_ID = 128; // setting keys are free text up to this
export const MAX_PURGED = 100_000;
export const actorSchema = z.string().min(1).max(128);
export const entityIdSchema = z.string().min(1).max(MAX_ENTITY_ID);
export const purgedSchema = z
  .array(z.object({ entity: z.enum(ENTITIES), id: ulid }))
  .max(MAX_PURGED);

export function entityIdOk(entity: Entity, id: string): boolean {
  if (entity === 'setting') return true;
  if (entity === 'note_tag') {
    const [a, b, ...rest] = id.split(':');
    return rest.length === 0 && ULID_RE.test(a ?? '') && ULID_RE.test(b ?? '');
  }
  return ULID_RE.test(id);
}

export function checkRow(
  v: {
    entity: Entity;
    entityId: string;
    op: Op;
    fields?: Record<string, unknown> | null;
    purgedIds?: unknown;
  },
  c: z.RefinementCtx,
): void {
  if (!entityIdOk(v.entity, v.entityId))
    c.addIssue({ code: 'custom', message: 'entityId is not a valid id' });
  if (v.fields) {
    // Bodies are referenced by version/hash, never inlined (also keeps the append-only log small).
    if ('body' in v.fields || 'text' in v.fields)
      c.addIssue({ code: 'custom', message: 'fields must not carry note text' });
    if (JSON.stringify(v.fields).length > MAX_FIELDS_BYTES)
      c.addIssue({ code: 'custom', message: 'fields too large' });
  }
  if (v.purgedIds && v.op !== 'purge')
    c.addIssue({ code: 'custom', message: 'purged ids only on purge' });
}
