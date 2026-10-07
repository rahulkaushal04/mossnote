/**
 * Map version history: snapshots, the automatic safety net, and restore.
 *
 * Automatic versions are taken at most every ten minutes and only before a change, so a map that
 * is being drawn on costs nothing extra. Manual versions are kept longer. Restoring keeps what it
 * replaces as its own version, so a restore can always be undone.
 */
import { LIMITS } from '@shared/constants';
import { readScene, type PinProps } from '@shared/schemas/map';
import type { LinkType, MapDetail, MapVersionInfo } from '@shared/types';
import { notFound } from '../../errors';
import { inTx, iso, type Ctx } from '../ctx';
import { nextUpdatedAt } from '../records';
import { insertPinRow } from './pins';
import { getMap, loadMap, parseProps, parseScene, pinRows, type MapRow, type PinRow } from './rows';

/** A pin as stored inside a snapshot. Its link is carried as a `{type, id}` pair. */
export interface SnapshotPin {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  note: string;
  props: PinProps;
  target: { type: LinkType; id: string } | null;
}

/** The whole of a map at one moment: its scene (kept as raw JSON) and its pins. */
export interface Snapshot {
  scene: unknown;
  pins: SnapshotPin[];
}

type VersionKind = MapVersionInfo['kind'];

/** How many versions of each kind are kept per map. */
const KEEP_BY_KIND: readonly (readonly [VersionKind, number])[] = [
  ['auto', LIMITS.mapVersionsAuto],
  ['restore', LIMITS.mapVersionsAuto],
  ['manual', LIMITS.mapVersionsManual],
];

function snapshotTarget(pin: PinRow): SnapshotPin['target'] {
  if (pin.target_note_id) return { type: 'note', id: pin.target_note_id };
  if (pin.target_person_id) return { type: 'person', id: pin.target_person_id };
  if (pin.target_planting_id) return { type: 'planting', id: pin.target_planting_id };
  return null;
}

/** Capture a map's scene and pins as they are now. */
export function snapshotOf(ctx: Ctx, row: MapRow): Snapshot {
  return {
    scene: JSON.parse(row.scene) as unknown,
    pins: pinRows(ctx, row.id).map((pin) => ({
      id: pin.id,
      x: pin.x,
      y: pin.y,
      label: pin.label,
      color: pin.color,
      note: pin.note,
      props: parseProps(pin.props),
      target: snapshotTarget(pin),
    })),
  };
}

/** Store a snapshot, then trim old versions of each kind to their limit. */
function insertVersion(
  ctx: Ctx,
  mapId: string,
  kind: VersionKind,
  snapshot: Snapshot,
  name: string | null,
): void {
  ctx.sqlite
    .prepare(
      'INSERT INTO map_versions (id, map_id, name, kind, snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(ctx.newId(), mapId, name, kind, JSON.stringify(snapshot), ctx.clock.now());
  for (const [versionKind, keep] of KEEP_BY_KIND) {
    ctx.sqlite
      .prepare(
        `DELETE FROM map_versions WHERE map_id = ? AND kind = ? AND id NOT IN
           (SELECT id FROM map_versions WHERE map_id = ? AND kind = ? ORDER BY created_at DESC, id DESC LIMIT ?)`,
      )
      .run(mapId, versionKind, mapId, versionKind, keep);
  }
}

/**
 * Before a change, keep how the map looked if the newest version is older than the gap in
 * `LIMITS.mapVersionGapMs`. Empty maps are not worth keeping.
 */
export function autoVersion(ctx: Ctx, row: MapRow): void {
  const newest = ctx.sqlite
    .prepare('SELECT max(created_at) AS at FROM map_versions WHERE map_id = ?')
    .get(row.id) as { at: number | null };
  if (newest.at !== null && ctx.clock.now() - newest.at < LIMITS.mapVersionGapMs) return;
  const snapshot = snapshotOf(ctx, row);
  const isEmpty = parseScene(row.scene).shapes.length === 0 && snapshot.pins.length === 0;
  if (!isEmpty) insertVersion(ctx, row.id, 'auto', snapshot, null);
}

/** Versions of a map, newest first, with counts for display. */
export function listVersions(ctx: Ctx, mapId: string): MapVersionInfo[] {
  loadMap(ctx, mapId);
  const rows = ctx.sqlite
    .prepare(
      'SELECT id, name, kind, snapshot, created_at FROM map_versions WHERE map_id = ? ORDER BY created_at DESC, id DESC',
    )
    .all(mapId) as {
    id: string;
    name: string | null;
    kind: VersionKind;
    snapshot: string;
    created_at: number;
  }[];
  return rows.map((row) => {
    const snapshot = JSON.parse(row.snapshot) as Snapshot;
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      shapes: parseScene(JSON.stringify(snapshot.scene)).shapes.length,
      pins: snapshot.pins.length,
      createdAt: iso(row.created_at),
    };
  });
}

/** Save a named version on purpose and return the updated list. */
export function saveVersion(ctx: Ctx, mapId: string, name: string | undefined): MapVersionInfo[] {
  return inTx(ctx, () => {
    const row = loadMap(ctx, mapId);
    insertVersion(ctx, mapId, 'manual', snapshotOf(ctx, row), name ?? null);
    return listVersions(ctx, mapId);
  });
}

export function deleteVersion(ctx: Ctx, mapId: string, versionId: string): void {
  loadMap(ctx, mapId);
  ctx.sqlite.prepare('DELETE FROM map_versions WHERE id = ? AND map_id = ?').run(versionId, mapId);
}

/** Put the map back as it was. The state it replaces is kept as a version first. */
export function restoreVersion(ctx: Ctx, mapId: string, versionId: string): MapDetail {
  return inTx(ctx, () => {
    const row = loadMap(ctx, mapId);
    const found = ctx.sqlite
      .prepare('SELECT snapshot FROM map_versions WHERE id = ? AND map_id = ?')
      .get(versionId, mapId) as { snapshot: string } | undefined;
    if (!found) throw notFound('That version is not here.');
    insertVersion(ctx, mapId, 'restore', snapshotOf(ctx, row), 'Before restoring');
    const snapshot = JSON.parse(found.snapshot) as Snapshot;
    const scene = JSON.stringify(readScene(snapshot.scene));
    ctx.sqlite.prepare('DELETE FROM map_pins WHERE map_id = ?').run(mapId);
    const now = ctx.clock.now();
    for (const pin of snapshot.pins) insertPinRow(ctx, mapId, pin.id, pin, now, true);
    ctx.sqlite
      .prepare('UPDATE maps SET scene = ?, updated_at = ? WHERE id = ?')
      .run(scene, nextUpdatedAt(ctx, row.updated_at), mapId);
    return getMap(ctx, mapId);
  });
}
