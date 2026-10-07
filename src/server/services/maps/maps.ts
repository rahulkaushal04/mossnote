/**
 * Map lifecycle and the editor's save path: list, create, rename/save scene, soft delete, restore,
 * and the atomic `applyChanges` the editor posts on every autosave.
 */
import { emptyScene, layeredScene } from '@shared/mapDefaults';
import type { MapChanges, MapCreate, MapListQuery, MapPatch } from '@shared/schemas/map';
import type { MapDetail, MapSummary, Page } from '@shared/types';
import { validationFailed } from '../../errors';
import { inTx, iso, offsetFromCursor, pageOf, type Ctx } from '../ctx';
import { assertFresh, nextUpdatedAt } from '../records';
import { assertPinLimit, insertPinRow, updatePinRow } from './pins';
import {
  getMap,
  loadMap,
  MAX_SCENE_CHARS,
  toDetail,
  toSummary,
  type MapRow,
  type PinRow,
} from './rows';
import { autoVersion } from './versions';

export { getMap };

const SCENE_TOO_LARGE = 'This map has too many drawings.';

function assertSceneSize(scene: string): void {
  if (scene.length > MAX_SCENE_CHARS) {
    throw validationFailed(SCENE_TOO_LARGE, { scene: 'Too large.' });
  }
}

export function listMaps(ctx: Ctx, query: MapListQuery): Page<MapSummary> {
  const offset = offsetFromCursor(query.cursor);
  const rows = ctx.sqlite
    .prepare(
      'SELECT * FROM maps WHERE deleted_at IS NULL ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?',
    )
    .all(query.limit + 1, offset) as MapRow[];
  const { items, nextCursor } = pageOf(rows, query.limit, offset);
  return { items: items.map((row) => toSummary(ctx, row)), nextCursor };
}

/** Create a map. Passing an existing `id` is a no-op that returns that map (idempotent retries). */
export function createMap(ctx: Ctx, input: MapCreate): { map: MapDetail; created: boolean } {
  return inTx(ctx, () => {
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM maps WHERE id = ?').get(input.id) as
        MapRow | undefined;
      if (existing) return { map: toDetail(ctx, existing), created: false };
    }
    const id = input.id ?? ctx.newId();
    const now = ctx.clock.now();
    const scene = input.template === 'layers' ? layeredScene() : emptyScene();
    ctx.sqlite
      .prepare('INSERT INTO maps (id, name, scene, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.name ?? 'Untitled map', JSON.stringify(scene), now, now);
    return { map: getMap(ctx, id), created: true };
  });
}

/** Rename a map or replace its scene. A stale `expectedUpdatedAt` is a 409 with the current map. */
export function patchMap(ctx: Ctx, id: string, patch: MapPatch): MapDetail {
  return inTx(ctx, () => {
    const row = loadMap(ctx, id);
    assertFresh(patch.expectedUpdatedAt, row.updated_at, () => getMap(ctx, id), 'map');
    const scene = patch.scene === undefined ? row.scene : JSON.stringify(patch.scene);
    assertSceneSize(scene);
    if (scene !== row.scene) autoVersion(ctx, row);
    ctx.sqlite
      .prepare('UPDATE maps SET name = ?, scene = ?, updated_at = ? WHERE id = ?')
      .run(patch.name ?? row.name, scene, nextUpdatedAt(ctx, row.updated_at), id);
    return getMap(ctx, id);
  });
}

export function deleteMap(ctx: Ctx, id: string): void {
  inTx(ctx, () => {
    const row = loadMap(ctx, id, true);
    if (row.deleted_at !== null) return;
    ctx.sqlite.prepare('UPDATE maps SET deleted_at = ? WHERE id = ?').run(ctx.clock.now(), id);
  });
}

export function restoreMap(ctx: Ctx, id: string): MapDetail {
  return inTx(ctx, () => {
    const row = loadMap(ctx, id, true);
    if (row.deleted_at !== null) {
      ctx.sqlite.prepare('UPDATE maps SET deleted_at = NULL WHERE id = ?').run(id);
    }
    return getMap(ctx, id);
  });
}

/**
 * Save the sketch and any pin changes in one transaction (`POST /api/maps/:id/changes`). The
 * editor sends one of these for every autosave, undo and redo, so a change is never half saved.
 */
export function applyChanges(ctx: Ctx, mapId: string, changes: MapChanges): { updatedAt: string } {
  return inTx(ctx, () => {
    const row = loadMap(ctx, mapId);
    const scene = changes.scene === undefined ? row.scene : JSON.stringify(changes.scene);
    assertSceneSize(scene);
    const touchesPins = (changes.upsert?.length ?? 0) + (changes.remove?.length ?? 0) > 0;
    if (scene !== row.scene || touchesPins) autoVersion(ctx, row);
    const now = ctx.clock.now();
    for (const id of changes.remove ?? []) {
      ctx.sqlite.prepare('DELETE FROM map_pins WHERE id = ? AND map_id = ?').run(id, mapId);
    }
    for (const pin of changes.upsert ?? []) {
      const existing = ctx.sqlite
        .prepare('SELECT * FROM map_pins WHERE id = ? AND map_id = ?')
        .get(pin.id, mapId) as PinRow | undefined;
      if (existing) {
        updatePinRow(ctx, existing, { ...pin, target: pin.target ?? null });
        continue;
      }
      if (ctx.sqlite.prepare('SELECT 1 FROM map_pins WHERE id = ?').get(pin.id)) {
        throw validationFailed('That pin id is already used.', { upsert: 'Id in use.' });
      }
      insertPinRow(ctx, mapId, pin.id, pin, now);
    }
    assertPinLimit(ctx, mapId, 'after-insert');
    const updatedAt = nextUpdatedAt(ctx, row.updated_at);
    ctx.sqlite
      .prepare('UPDATE maps SET scene = ?, updated_at = ? WHERE id = ?')
      .run(scene, updatedAt, mapId);
    return { updatedAt: iso(updatedAt) };
  });
}
