/**
 * Copying maps: duplicate one, export it as a project file, import a project file.
 *
 * Pins are given new ids on every copy, and any scene shape that refers to a pin id is rewritten
 * to match, so a copy never shares ids with its source.
 */
import { LIMITS } from '@shared/constants';
import { mapSceneSchema, readScene, type MapScene, type PinProps } from '@shared/schemas/map';
import type { LinkType, MapDetail } from '@shared/types';
import { inTx, iso, type Ctx } from '../ctx';
import { insertPinRow } from './pins';
import { getMap, loadMap, toDetail, type MapRow } from './rows';
import { snapshotOf } from './versions';

/** A pin as it travels in a copy or project file. Project files carry no links. */
interface ProjectPin {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  note: string;
  props: PinProps;
  target?: { type: LinkType; id: string } | null;
}

/** Swap every occurrence of an old pin id for its new one (pins may be referenced from the scene). */
function remapPinIds(scene: MapScene, newIdByOld: ReadonlyMap<string, string>): MapScene {
  let json = JSON.stringify(scene);
  for (const [from, to] of newIdByOld) json = json.replaceAll(`"${from}"`, `"${to}"`);
  return mapSceneSchema.parse(JSON.parse(json));
}

function insertCopy(
  ctx: Ctx,
  copy: { id: string; name: string; scene: MapScene; pins: readonly ProjectPin[] },
): void {
  const now = ctx.clock.now();
  const newIdByOld = new Map(copy.pins.map((pin) => [pin.id, ctx.newId()]));
  const scene = remapPinIds(copy.scene, newIdByOld);
  ctx.sqlite
    .prepare('INSERT INTO maps (id, name, scene, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(copy.id, copy.name, JSON.stringify(scene), now, now);
  for (const pin of copy.pins) {
    insertPinRow(ctx, copy.id, newIdByOld.get(pin.id) ?? ctx.newId(), pin, now, true);
  }
}

/** Duplicate a map with its pins. Passing an existing `id` returns that map (idempotent retries). */
export function duplicateMap(
  ctx: Ctx,
  sourceId: string,
  input: { id?: string | undefined; name?: string | undefined },
): MapDetail {
  return inTx(ctx, () => {
    const source = loadMap(ctx, sourceId);
    if (input.id) {
      const existing = ctx.sqlite.prepare('SELECT * FROM maps WHERE id = ?').get(input.id) as
        MapRow | undefined;
      if (existing) return toDetail(ctx, existing);
    }
    const snapshot = snapshotOf(ctx, source);
    const id = input.id ?? ctx.newId();
    const name = (input.name ?? `${source.name} copy`).slice(0, LIMITS.mapName);
    insertCopy(ctx, { id, name, scene: readScene(snapshot.scene), pins: snapshot.pins });
    return getMap(ctx, id);
  });
}

/** The editable project file for one map (`GET /api/maps/:id/export.json`). */
export function exportMapProject(ctx: Ctx, mapId: string) {
  const row = loadMap(ctx, mapId);
  const snapshot = snapshotOf(ctx, row);
  return {
    format: 'mossnote-map' as const,
    formatVersion: 1,
    exportedAt: iso(ctx.clock.now()),
    name: row.name,
    scene: readScene(snapshot.scene),
    // Links point into one journal, so they are not carried to a file.
    pins: snapshot.pins.map((pin) => ({
      id: pin.id,
      x: pin.x,
      y: pin.y,
      label: pin.label,
      color: pin.color,
      note: pin.note,
      props: pin.props,
    })),
  };
}

/** Create a new map from a project file. */
export function importMapProject(
  ctx: Ctx,
  file: { name: string; scene: MapScene; pins: Omit<ProjectPin, 'target'>[] },
  id?: string,
): MapDetail {
  return inTx(ctx, () => {
    const newId = id ?? ctx.newId();
    insertCopy(ctx, {
      id: newId,
      name: file.name.slice(0, LIMITS.mapName),
      scene: file.scene,
      pins: file.pins,
    });
    return getMap(ctx, newId);
  });
}
