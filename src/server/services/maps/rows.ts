/**
 * Row types and read helpers shared by every map service module.
 *
 * Owns the shape of the `maps` and `map_pins` tables as `better-sqlite3` returns them (snake_case,
 * JSON stored as text) and the functions that turn rows into the API's `MapDetail`/`MapPin`. It
 * does not write anything except `touchMap`.
 */
import { emptyScene } from '@shared/mapDefaults';
import { pinPropsSchema, readScene, type MapScene, type PinProps } from '@shared/schemas/map';
import type { LinkRef, MapDetail, MapPin, MapSummary } from '@shared/types';
import { notFound } from '../../errors';
import { iso, type Ctx } from '../ctx';
import { noteLabel } from '../links';
import { nextUpdatedAt } from '../records';

export interface MapRow {
  id: string;
  name: string;
  scene: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface PinRow {
  id: string;
  map_id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  note: string;
  props: string;
  target_note_id: string | null;
  target_person_id: string | null;
  target_planting_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Upper bound on the serialised scene, so one map cannot grow without limit. */
export const MAX_SCENE_CHARS = 900_000;

/** Load a map row, or throw `not_found`. Soft-deleted maps count as missing unless asked for. */
export function loadMap(ctx: Ctx, id: string, includeDeleted = false): MapRow {
  const row = ctx.sqlite.prepare('SELECT * FROM maps WHERE id = ?').get(id) as MapRow | undefined;
  if (!row || (!includeDeleted && row.deleted_at !== null)) throw notFound('That map is not here.');
  return row;
}

/** Load a pin that belongs to `mapId`, or throw `not_found`. */
export function loadPin(ctx: Ctx, mapId: string, pinId: string): PinRow {
  const row = ctx.sqlite
    .prepare('SELECT * FROM map_pins WHERE id = ? AND map_id = ?')
    .get(pinId, mapId) as PinRow | undefined;
  if (!row) throw notFound('That pin is not here.');
  return row;
}

/**
 * Read a stored scene. Unreadable or unknown JSON yields an empty scene rather than an error, so
 * one bad row never makes a map unopenable.
 */
export function parseScene(json: string): MapScene {
  try {
    return readScene(JSON.parse(json));
  } catch {
    return emptyScene();
  }
}

/** Read stored pin props, falling back to none when the JSON is invalid. */
export function parseProps(json: string): PinProps {
  try {
    const parsed = pinPropsSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function pinCount(ctx: Ctx, mapId: string): number {
  const row = ctx.sqlite
    .prepare('SELECT count(*) AS n FROM map_pins WHERE map_id = ?')
    .get(mapId) as {
    n: number;
  };
  return row.n;
}

export function pinRows(ctx: Ctx, mapId: string): PinRow[] {
  return ctx.sqlite
    .prepare('SELECT * FROM map_pins WHERE map_id = ? ORDER BY created_at, id')
    .all(mapId) as PinRow[];
}

export function toSummary(ctx: Ctx, row: MapRow): MapSummary {
  return {
    id: row.id,
    name: row.name,
    pinCount: pinCount(ctx, row.id),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** The label a pin shows for what it points to. Soft-deleted targets read as no link. */
function resolveTarget(ctx: Ctx, row: PinRow): LinkRef | null {
  if (row.target_note_id) {
    const note = ctx.sqlite
      .prepare('SELECT title, body FROM notes WHERE id = ? AND deleted_at IS NULL')
      .get(row.target_note_id) as { title: string | null; body: string } | undefined;
    return note
      ? { type: 'note', id: row.target_note_id, label: noteLabel(note.title, note.body) }
      : null;
  }
  if (row.target_person_id) {
    const person = ctx.sqlite
      .prepare('SELECT name FROM people WHERE id = ? AND deleted_at IS NULL')
      .get(row.target_person_id) as { name: string } | undefined;
    return person ? { type: 'person', id: row.target_person_id, label: person.name } : null;
  }
  if (row.target_planting_id) {
    const planting = ctx.sqlite
      .prepare('SELECT label FROM plantings WHERE id = ? AND deleted_at IS NULL')
      .get(row.target_planting_id) as { label: string } | undefined;
    return planting
      ? { type: 'planting', id: row.target_planting_id, label: planting.label }
      : null;
  }
  return null;
}

export function toPin(ctx: Ctx, row: PinRow): MapPin {
  return {
    id: row.id,
    mapId: row.map_id,
    x: row.x,
    y: row.y,
    label: row.label,
    color: row.color,
    note: row.note,
    props: parseProps(row.props),
    target: resolveTarget(ctx, row),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function toDetail(ctx: Ctx, row: MapRow): MapDetail {
  return {
    ...toSummary(ctx, row),
    scene: parseScene(row.scene),
    pins: pinRows(ctx, row.id).map((pin) => toPin(ctx, pin)),
  };
}

/** Load a live map and return it as the API shape. */
export function getMap(ctx: Ctx, id: string): MapDetail {
  return toDetail(ctx, loadMap(ctx, id));
}

/**
 * Touching a pin counts as editing its map, so list order and stale-edit checks stay honest.
 */
export function touchMap(ctx: Ctx, mapId: string): void {
  const row = loadMap(ctx, mapId);
  ctx.sqlite
    .prepare('UPDATE maps SET updated_at = ? WHERE id = ?')
    .run(nextUpdatedAt(ctx, row.updated_at), mapId);
}
