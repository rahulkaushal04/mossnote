/**
 * Read-only queries across maps: which pins point at a record, map search, and the "Places" list.
 */
import type { MapListQuery } from '@shared/schemas/map';
import { fold } from '@shared/text';
import type { LinkType, MapHit, MapPin, Page, PinRef } from '@shared/types';
import { offsetFromCursor, pageOf, type Ctx } from '../ctx';
import { parseProps, parseScene, toPin, type MapRow, type PinRow } from './rows';

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

/** True when JSON would store `text` unchanged: no quote, backslash or control character in it. */
function isStoredAsTyped(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x22 || code === 0x5c) return false;
  }
  return true;
}

/** What a person wrote in a pin's settings: its status, its tags, and its field names and values. */
function pinSettingsText(propsJson: string): string[] {
  const props = parseProps(propsJson);
  return [
    props.status ?? '',
    ...(props.tags ?? []),
    ...(props.fields ?? []).flatMap((field) => [field.label, field.value]),
  ];
}

/**
 * Maps match by name, by names, notes and text on the sketch, and by pin name, note, status, tags
 * and fields. The text is compared here, ignoring case and accents as the rest of search does,
 * which SQLite's LIKE cannot do. Matching the stored JSON instead would also find the names of
 * its settings and the characters it escapes. Maps are few and small, so they stay out of the
 * full-text index; the newest are read first and reading stops at `limit`.
 */
export function searchMaps(ctx: Ctx, q: string, limit = 20): MapHit[] {
  const needle = fold(q.trim());
  if (needle === '') return [];
  const matches = (text: string) => fold(text).includes(needle);
  // A sketch is stored as JSON, which writes a quote, a backslash or a control character as an
  // escape. Without those in the search, its words appear in the stored text as they were typed,
  // so a sketch whose stored text lacks them can be skipped without reading it properly.
  const literal = isStoredAsTyped(needle);
  const hits: MapHit[] = [];

  const maps = ctx.sqlite
    .prepare('SELECT id, name FROM maps WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC')
    .all() as { id: string; name: string }[];
  const sceneOf = ctx.sqlite.prepare('SELECT scene FROM maps WHERE id = ?');
  for (const m of maps) {
    if (hits.length >= limit) break;
    if (matches(m.name)) {
      hits.push({ mapId: m.id, mapName: m.name, pinId: null, title: m.name, snippet: null });
      continue;
    }
    const { scene } = sceneOf.get(m.id) as Pick<MapRow, 'scene'>;
    if (literal && !fold(scene).includes(needle)) continue;
    for (const shape of parseScene(scene).shapes) {
      const text = [shape.t === 'text' ? shape.text : '', shape.name ?? '', shape.note ?? ''].find(
        matches,
      );
      if (text) {
        hits.push({ mapId: m.id, mapName: m.name, pinId: null, title: m.name, snippet: text });
        break;
      }
    }
  }
  if (hits.length >= limit) return hits;

  const pins = ctx.sqlite
    .prepare(
      `SELECT pin.id, pin.label, pin.note, pin.props, m.id AS map_id, m.name AS map_name
       FROM map_pins pin JOIN maps m ON m.id = pin.map_id
       WHERE m.deleted_at IS NULL ORDER BY pin.updated_at DESC, pin.id DESC`,
    )
    .all() as {
    id: string;
    label: string;
    note: string;
    props: string;
    map_id: string;
    map_name: string;
  }[];
  for (const p of pins) {
    if (hits.length >= limit) break;
    if (!matches(p.label) && !matches(p.note) && !pinSettingsText(p.props).some(matches)) continue;
    hits.push({
      mapId: p.map_id,
      mapName: p.map_name,
      pinId: p.id,
      title: p.label || 'Unnamed pin',
      snippet: p.note === '' ? null : p.note.slice(0, 160),
    });
  }
  return hits;
}

/** Every live pin across live maps, newest first, a page at a time: the "Places" view. */
export function listPlaces(ctx: Ctx, query: MapListQuery): Page<MapPin & { mapName: string }> {
  const offset = offsetFromCursor(query.cursor);
  const rows = ctx.sqlite
    .prepare(
      `SELECT pin.*, m.name AS map_name FROM map_pins pin JOIN maps m ON m.id = pin.map_id
       WHERE m.deleted_at IS NULL ORDER BY pin.updated_at DESC, pin.id DESC LIMIT ? OFFSET ?`,
    )
    .all(query.limit + 1, offset) as (PinRow & { map_name: string })[];
  const { items, nextCursor } = pageOf(rows, query.limit, offset);
  return { items: items.map((r) => ({ ...toPin(ctx, r), mapName: r.map_name })), nextCursor };
}
