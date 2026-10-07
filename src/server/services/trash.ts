import type { TrashItem } from '@shared/types';
import { notFound } from '../errors';
import { inTx, iso, type Ctx } from './ctx';
import { noteLabel } from './links';
import { restoreNote } from './notes';
import { restorePerson } from './people';
import { restoreMap } from './maps';
import { restorePlanting } from './plantings';

export type TrashKind = 'note' | 'person' | 'planting' | 'map';

const LIST = `
  SELECT 'note' AS kind, id, title, body AS text, deleted_at FROM notes WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'person', id, name, '', deleted_at FROM people WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'planting', id, label, '', deleted_at FROM plantings WHERE deleted_at IS NOT NULL
  UNION ALL SELECT 'map', id, name, '', deleted_at FROM maps WHERE deleted_at IS NOT NULL
  ORDER BY deleted_at DESC, id DESC`;

/** Soft-deleted records, newest deletion first (`GET /api/trash`). */
export function listTrash(ctx: Ctx, kind?: TrashKind): TrashItem[] {
  const rows = ctx.sqlite.prepare(LIST).all() as {
    kind: TrashKind;
    id: string;
    title: string | null;
    text: string;
    deleted_at: number;
  }[];
  return rows
    .filter((r) => kind === undefined || r.kind === kind)
    .map((r) => ({
      kind: r.kind,
      id: r.id,
      label: r.kind === 'note' ? noteLabel(r.title, r.text) : (r.title ?? ''),
      deletedAt: iso(r.deleted_at),
    }));
}

const IS_DELETED: Record<TrashKind, string> = {
  note: 'SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NOT NULL',
  person: 'SELECT 1 FROM people WHERE id = ? AND deleted_at IS NOT NULL',
  planting: 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NOT NULL',
  map: 'SELECT 1 FROM maps WHERE id = ? AND deleted_at IS NOT NULL',
};
const HARD_DELETE: Record<TrashKind, string> = {
  note: 'DELETE FROM notes WHERE id = ? AND deleted_at IS NOT NULL',
  person: 'DELETE FROM people WHERE id = ? AND deleted_at IS NOT NULL',
  planting: 'DELETE FROM plantings WHERE id = ? AND deleted_at IS NOT NULL',
  map: 'DELETE FROM maps WHERE id = ? AND deleted_at IS NOT NULL',
};

function assertInTrash(ctx: Ctx, kind: TrashKind, id: string): void {
  if (!ctx.sqlite.prepare(IS_DELETED[kind]).get(id)) throw notFound("That isn't in the trash.");
}

export function restoreFromTrash(ctx: Ctx, kind: TrashKind, id: string): unknown {
  assertInTrash(ctx, kind, id);
  if (kind === 'note') return restoreNote(ctx, id);
  if (kind === 'person') return restorePerson(ctx, id);
  if (kind === 'map') return restoreMap(ctx, id);
  return restorePlanting(ctx, id);
}

/** Delete forever: the row, its tag joins and every link to or from it (cascade). */
export function deleteForever(ctx: Ctx, kind: TrashKind, id: string): void {
  inTx(ctx, () => {
    assertInTrash(ctx, kind, id);
    ctx.sqlite.prepare(HARD_DELETE[kind]).run(id);
  });
}

export function emptyTrash(ctx: Ctx): number {
  return inTx(ctx, () => {
    let removed = 0;
    for (const kind of ['note', 'person', 'planting', 'map'] as const) {
      removed += ctx.sqlite.prepare(HARD_DELETE_ALL[kind]).run().changes;
    }
    return removed;
  });
}

const HARD_DELETE_ALL: Record<TrashKind, string> = {
  note: 'DELETE FROM notes WHERE deleted_at IS NOT NULL',
  person: 'DELETE FROM people WHERE deleted_at IS NOT NULL',
  planting: 'DELETE FROM plantings WHERE deleted_at IS NOT NULL',
  map: 'DELETE FROM maps WHERE deleted_at IS NOT NULL',
};

export const RETENTION_DAYS = 30;

/** Purge records deleted more than 30 days ago (run at server start, spec section 18). */
export function purgeOldTrash(ctx: Pick<Ctx, 'sqlite' | 'clock'>, days = RETENTION_DAYS): number {
  const cutoff = ctx.clock.now() - days * 24 * 3_600_000;
  const run = ctx.sqlite.transaction(() => {
    let removed = 0;
    for (const table of ['notes', 'people', 'plantings', 'maps'] as const) {
      removed += ctx.sqlite.prepare(PURGE[table]).run(cutoff).changes;
    }
    return removed;
  });
  return run();
}

const PURGE = {
  notes: 'DELETE FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?',
  people: 'DELETE FROM people WHERE deleted_at IS NOT NULL AND deleted_at < ?',
  plantings: 'DELETE FROM plantings WHERE deleted_at IS NOT NULL AND deleted_at < ?',
  maps: 'DELETE FROM maps WHERE deleted_at IS NOT NULL AND deleted_at < ?',
} as const;
