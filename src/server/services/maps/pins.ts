/**
 * Pin writes: create, patch, delete, and the row-level insert/update that versions, duplicates
 * and `applyChanges` reuse.
 *
 * A pin may link to one note, person or planting. The link is stored as three nullable columns,
 * so exactly one (or none) is set; `resolveTargetColumns` keeps that true.
 */
import { LIMITS } from '@shared/constants';
import type { PinCreate, PinPatch } from '@shared/schemas/map';
import type { LinkType, MapPin } from '@shared/types';
import { validationFailed } from '../../errors';
import { inTx, type Ctx } from '../ctx';
import { nextUpdatedAt } from '../records';
import { loadMap, loadPin, pinCount, toPin, touchMap, type PinRow } from './rows';

const TARGET_EXISTS: Record<LinkType, string> = {
  note: 'SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL',
  person: 'SELECT 1 FROM people WHERE id = ? AND deleted_at IS NULL',
  planting: 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NULL',
};

export interface TargetColumns {
  noteId: string | null;
  personId: string | null;
  plantingId: string | null;
}

const NO_TARGET: TargetColumns = { noteId: null, personId: null, plantingId: null };

const MAX_PINS_MESSAGE = 'A map can hold up to 500 pins.';

/**
 * Work out the link columns for a write.
 *
 * `undefined` keeps `current`; `null` clears the link. A link to something that no longer exists
 * is rejected, unless `lenient` (restoring a version or importing), where it is dropped and the
 * pin is kept.
 */
function resolveTargetColumns(
  ctx: Ctx,
  target: { type: LinkType; id: string } | null | undefined,
  current: TargetColumns,
  lenient = false,
): TargetColumns {
  if (target === undefined) return current;
  if (target === null) return NO_TARGET;
  if (!ctx.sqlite.prepare(TARGET_EXISTS[target.type]).get(target.id)) {
    if (lenient) return NO_TARGET;
    throw validationFailed("That link can't be added.", { target: "That link can't be added." });
  }
  return {
    noteId: target.type === 'note' ? target.id : null,
    personId: target.type === 'person' ? target.id : null,
    plantingId: target.type === 'planting' ? target.id : null,
  };
}

/** Insert one pin row. Does not check limits or touch the map. */
export function insertPinRow(
  ctx: Ctx,
  mapId: string,
  id: string,
  input: PinCreate,
  now: number,
  lenient = false,
): void {
  const target = resolveTargetColumns(ctx, input.target, NO_TARGET, lenient);
  ctx.sqlite
    .prepare(
      `INSERT INTO map_pins (id, map_id, x, y, label, color, note, props, target_note_id,
         target_person_id, target_planting_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      mapId,
      input.x,
      input.y,
      input.label ?? '',
      input.color ?? 'moss',
      input.note ?? '',
      JSON.stringify(input.props ?? {}),
      target.noteId,
      target.personId,
      target.plantingId,
      now,
      now,
    );
}

/** Apply a partial update to an existing pin row. Omitted fields keep their value. */
export function updatePinRow(ctx: Ctx, row: PinRow, patch: PinPatch): void {
  const target = resolveTargetColumns(ctx, patch.target, {
    noteId: row.target_note_id,
    personId: row.target_person_id,
    plantingId: row.target_planting_id,
  });
  ctx.sqlite
    .prepare(
      `UPDATE map_pins SET x = ?, y = ?, label = ?, color = ?, note = ?, props = ?, target_note_id = ?,
         target_person_id = ?, target_planting_id = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      patch.x ?? row.x,
      patch.y ?? row.y,
      patch.label ?? row.label,
      patch.color ?? row.color,
      patch.note ?? row.note,
      patch.props === undefined ? row.props : JSON.stringify(patch.props),
      target.noteId,
      target.personId,
      target.plantingId,
      nextUpdatedAt(ctx, row.updated_at),
      row.id,
    );
}

/**
 * Throw `validation_failed` when a map is over its pin limit. Call `before-insert` to check there
 * is room for one more, or `after-insert` to check the count a batch of writes left behind.
 */
export function assertPinLimit(
  ctx: Ctx,
  mapId: string,
  when: 'before-insert' | 'after-insert',
): void {
  const count = pinCount(ctx, mapId);
  const over = when === 'before-insert' ? count >= LIMITS.pinsPerMap : count > LIMITS.pinsPerMap;
  if (over) {
    throw validationFailed(MAX_PINS_MESSAGE, { pins: 'Too many pins.' });
  }
}

/** Create a pin. Passing an existing `id` is a no-op that returns the pin (idempotent retries). */
export function createPin(
  ctx: Ctx,
  mapId: string,
  input: PinCreate,
): { pin: MapPin; created: boolean } {
  return inTx(ctx, () => {
    loadMap(ctx, mapId);
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM map_pins WHERE id = ?').get(input.id) as
        PinRow | undefined;
      if (existing) return { pin: toPin(ctx, existing), created: false };
    }
    assertPinLimit(ctx, mapId, 'before-insert');
    const id = input.id ?? ctx.newId();
    insertPinRow(ctx, mapId, id, input, ctx.clock.now());
    touchMap(ctx, mapId);
    return { pin: toPin(ctx, loadPin(ctx, mapId, id)), created: true };
  });
}

export function patchPin(ctx: Ctx, mapId: string, pinId: string, patch: PinPatch): MapPin {
  return inTx(ctx, () => {
    loadMap(ctx, mapId);
    updatePinRow(ctx, loadPin(ctx, mapId, pinId), patch);
    touchMap(ctx, mapId);
    return toPin(ctx, loadPin(ctx, mapId, pinId));
  });
}

export function deletePin(ctx: Ctx, mapId: string, pinId: string): void {
  inTx(ctx, () => {
    loadMap(ctx, mapId);
    ctx.sqlite.prepare('DELETE FROM map_pins WHERE id = ? AND map_id = ?').run(pinId, mapId);
    touchMap(ctx, mapId);
  });
}
