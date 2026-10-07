/** Response shapes from spec section 11. Timestamps are ISO 8601 UTC strings. */
import type { MapScene, PinProps } from './schemas/map';

export type LinkType = 'note' | 'person' | 'planting';

export interface LinkRef {
  type: LinkType;
  id: string;
  label: string;
}

export interface NoteQuestion {
  state: 'open' | 'solved';
  resolution: string | null;
  solvedGameDate: number | null;
  solvedAt: string | null;
}

export interface Note {
  id: string;
  title: string | null;
  body: string;
  gameDate: number | null;
  isDiscovery: boolean;
  question: NoteQuestion | null;
  tags: string[];
  links: LinkRef[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/notes/:id` adds the notes that link here. */
export interface NoteDetail extends Note {
  linkedFrom: LinkRef[];
}

export interface CustomField {
  label: string;
  value: string;
}

export interface Person {
  id: string;
  name: string;
  notes: string;
  progress: number | null;
  progressMax: number | null;
  customFields: CustomField[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Planting {
  id: string;
  label: string;
  plantedOn: number | null;
  harvestedOn: number | null;
  plantedCount: number | null;
  harvestedCount: number | null;
  notes: string;
  customFields: CustomField[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  pinned: boolean;
  counts: { notes: number; people: number; plantings: number };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Snippets mark matches with U+0001 (start) and U+0002 (end); the client renders `<mark>`. */
export interface SearchHit {
  kind: 'note' | 'person' | 'planting' | 'tag';
  id: string;
  title: string;
  snippet: string | null;
  gameDate: number | null;
}

export interface SearchResponse {
  groups: {
    notes: SearchHit[];
    people: SearchHit[];
    plantings: SearchHit[];
    tags: SearchHit[];
    maps: MapHit[];
  };
  /** True when nothing matched every word and these are "Partial matches". */
  partial: boolean;
}

/** A map, or a pin on one, that matched a search. `pinId` is set for a pin. */
export interface MapHit {
  mapId: string;
  mapName: string;
  pinId: string | null;
  title: string;
  snippet: string | null;
}

export interface PickItem {
  kind: 'tag' | 'person' | 'note' | 'planting';
  id: string;
  label: string;
  /** Secondary text, for example a game date or "Note". */
  detail: string | null;
}

export interface DataInfo {
  dataDir: string;
  databasePath: string;
  databaseBytes: number;
  counts: { notes: number; people: number; plantings: number; tags: number; maps: number };
  lastBackupAt: string | null;
}

export interface BackupInfo {
  name: string;
  reason: 'auto' | 'pre-migration' | 'pre-import' | 'manual';
  size: number;
  takenAt: string;
}

export interface TrashItem {
  kind: 'note' | 'person' | 'planting' | 'map';
  id: string;
  label: string;
  deletedAt: string;
}

export interface ImportSummary {
  counts: { notes: number; people: number; plantings: number; tags: number; maps: number };
  warnings: string[];
  errors: { path: string; message: string }[];
}

export interface MapSummary {
  id: string;
  name: string;
  pinCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MapPin {
  id: string;
  mapId: string;
  x: number;
  y: number;
  label: string;
  color: string;
  note: string;
  /** Marker type, icon, status, tags, custom fields, layer, lock, hide and group. */
  props: PinProps;
  /** The record this pin points to. Hidden when that record is deleted. */
  target: LinkRef | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/maps/:id`: the sketch and its pins. */
export interface MapDetail extends MapSummary {
  /** Validated by `mapSceneSchema`. */
  scene: MapScene;
  pins: MapPin[];
}

/** A pin shown on the page of the record it points to ("On maps"). */
export interface PinRef {
  pinId: string;
  mapId: string;
  mapName: string;
  label: string;
}

/** A saved state of a map, newest first in `GET /api/maps/:id/versions`. */
export interface MapVersionInfo {
  id: string;
  /** Set for a version saved on purpose. */
  name: string | null;
  kind: 'auto' | 'manual' | 'restore';
  shapes: number;
  pins: number;
  createdAt: string;
}
