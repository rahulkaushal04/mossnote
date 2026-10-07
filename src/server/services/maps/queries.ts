/**
 * Read-only queries across maps: which pins point at a record, map search, and the "Places" list.
 */
import type { LinkType, MapHit, MapPin, PinRef } from '@shared/types';
import type { Ctx } from '../ctx';
import { parseScene, toPin, type MapRow, type PinRow } from './rows';

const PINS_BY_TARGET: Record<LinkType, string> = {
  note: `SELECT pin.id AS pin_id, m.id AS map_id, m.name AS map_name, pin.label AS label
         FROM map_pins pin JOIN maps m ON m.id = pin.map_id
         WHERE pin.target_note_id = ? AND m.deleted_at IS NULL
         ORDER BY m.name COLLATE NOCASE, pin.created_at`,
  person: `SELECT pin.id AS pin_id, m.id AS map_id, m.name AS map_name, pin.label AS label
           FROM map_pins pin JOIN maps m ON m.id = pin.map_id
           WHERE pin.target_person_id = ? AND m.deleted_at IS NULL
           ORDER BY m.name COLLATE NOCASE, pin.created_at`,
  planting: `SELECT pin.id AS pin_id, m.id AS map_id, m.name AS map_name, pin.label AS label
             FROM map_pins pin JOIN maps m ON m.id = pin.map_id
             WHERE pin.target_planting_id = ? AND m.deleted_at IS NULL
             ORDER BY m.name COLLATE NOCASE, pin.created_at`,
};

/** Pins on live maps that point at a record, for its "On maps" section. */
export function pinsPointingAt(ctx: Ctx, type: LinkType, id: string): PinRef[] {
  const rows = ctx.sqlite.prepare(PINS_BY_TARGET[type]).all(id) as {
    pin_id: string;
    map_id: string;
    map_name: string;
    label: string;
  }[];
  return rows.map((r) => ({
    pinId: r.pin_id,
    mapId: r.map_id,
    mapName: r.map_name,
    label: r.label,
  }));
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Maps match by name, by names, notes and text on the sketch, and by pin name, note, status, tags
 * and fields. Small data and a plain case-insensitive substring match, so maps stay out of the
 * full-text index.
 */
export function searchMaps(ctx: Ctx, q: string, limit = 20): MapHit[] {
  const needle = q.trim();
  if (needle === '') return [];
  const like = `%${escapeLike(needle)}%`;
  const lower = needle.toLowerCase();
  const hits: MapHit[] = [];
  const maps = ctx.sqlite
    .prepare(
      `SELECT * FROM maps WHERE deleted_at IS NULL
       AND (name LIKE ? ESCAPE '\\' OR scene LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(like, like, limit) as MapRow[];
  for (const m of maps) {
    if (m.name.toLowerCase().includes(lower)) {
      hits.push({ mapId: m.id, mapName: m.name, pinId: null, title: m.name, snippet: null });
      continue;
    }
    for (const shape of parseScene(m.scene).shapes) {
      const text = [shape.t === 'text' ? shape.text : '', shape.name ?? '', shape.note ?? ''].find(
        (t) => t.toLowerCase().includes(lower),
      );
      if (text) {
        hits.push({ mapId: m.id, mapName: m.name, pinId: null, title: m.name, snippet: text });
        break;
      }
    }
  }
  const pins = ctx.sqlite
    .prepare(
      `SELECT pin.id, pin.label, pin.note, m.id AS map_id, m.name AS map_name
       FROM map_pins pin JOIN maps m ON m.id = pin.map_id
       WHERE m.deleted_at IS NULL AND (pin.label LIKE ? ESCAPE '\\' OR pin.note LIKE ? ESCAPE '\\'
         OR pin.props LIKE ? ESCAPE '\\')
       ORDER BY pin.updated_at DESC LIMIT ?`,
    )
    .all(like, like, like, limit) as {
    id: string;
    label: string;
    note: string;
    map_id: string;
    map_name: string;
  }[];
  for (const p of pins) {
    hits.push({
      mapId: p.map_id,
      mapName: p.map_name,
      pinId: p.id,
      title: p.label || 'Unnamed pin',
      snippet: p.note === '' ? null : p.note.slice(0, 160),
    });
  }
  return hits.slice(0, limit);
}

/** Every live pin across live maps, newest first: the "Places" view. */
export function listPlaces(ctx: Ctx): (MapPin & { mapName: string })[] {
  const rows = ctx.sqlite
    .prepare(
      `SELECT pin.*, m.name AS map_name FROM map_pins pin JOIN maps m ON m.id = pin.map_id
       WHERE m.deleted_at IS NULL ORDER BY pin.updated_at DESC, pin.id DESC LIMIT 500`,
    )
    .all() as (PinRow & { map_name: string })[];
  return rows.map((r) => ({ ...toPin(ctx, r), mapName: r.map_name }));
}
