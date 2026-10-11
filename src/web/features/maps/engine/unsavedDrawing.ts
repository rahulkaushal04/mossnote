import { mapSceneSchema } from '@shared/schemas/map';
import { currentJournalId } from '../../../lib/journal';
import { readStorage, writeStorage } from '../../../lib/storage';
import type { Doc } from './doc';

/** A keepalive request may carry 64 KiB in all, so a body is sent that way only below this. */
export const EXIT_REQUEST_BYTES = 60_000;

export const fitsExitRequest = (body: unknown): boolean =>
  new TextEncoder().encode(JSON.stringify(body)).length <= EXIT_REQUEST_BYTES;

export interface UnsavedDrawing {
  /** The map's `updatedAt` when the drawing was kept, to tell whether the map moved on since. */
  updatedAt: string;
  doc: Doc;
}

const key = (mapId: string) => `moss:unsavedMap:${currentJournalId() ?? 'none'}:${mapId}`;

/** Keeps a drawing that could not be saved. False when the browser refuses to store it. */
export function stashUnsaved(mapId: string, updatedAt: string, doc: Doc): boolean {
  const stored: UnsavedDrawing = { updatedAt, doc };
  return writeStorage(key(mapId), JSON.stringify(stored));
}

export function readUnsaved(mapId: string): UnsavedDrawing | null {
  const raw = readStorage(key(mapId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UnsavedDrawing>;
    const scene = mapSceneSchema.safeParse(parsed.doc?.scene);
    if (
      typeof parsed.updatedAt !== 'string' ||
      !scene.success ||
      !Array.isArray(parsed.doc?.pins)
    ) {
      return null;
    }
    return { updatedAt: parsed.updatedAt, doc: { scene: scene.data, pins: parsed.doc.pins } };
  } catch {
    return null;
  }
}

export function clearUnsaved(mapId: string): void {
  try {
    localStorage.removeItem(key(mapId));
  } catch {
    // storage unavailable: nothing was kept
  }
}
