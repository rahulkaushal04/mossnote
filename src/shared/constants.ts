/** Limits and defaults shared by server and client (spec sections 5.3, 9, 19). */

export const LIMITS = {
  noteBody: 50_000,
  noteTitle: 200,
  resolution: 2_000,
  personName: 80,
  personNotes: 20_000,
  plantingLabel: 80,
  plantingNotes: 20_000,
  progressMax: 99,
  customFields: 30,
  customFieldLabel: 40,
  customFieldValue: 500,
  count: 999_999,
  tagName: 40,
  tagsPerRecord: 30,
  linksPerNote: 50,
  mapName: 80,
  mapShapes: 3_000,
  mapLayers: 30,
  mapGuides: 50,
  shapeNote: 500,
  shapeName: 80,
  markerTypes: 50,
  pinTags: 10,
  pinStatus: 30,
  pinFields: 10,
  mapVersionsAuto: 30,
  mapVersionsManual: 50,
  mapVersionGapMs: 600_000,
  mapStrokePoints: 5_000,
  mapLabel: 120,
  mapText: 2000,
  mapCoord: 100_000,
  pinLabel: 80,
  pinNote: 5_000,
  pinsPerMap: 500,
  seasonsMin: 1,
  seasonsMax: 12,
  seasonName: 20,
  daysPerSeasonMax: 99,
  yearMax: 99_999,
  searchQuery: 200,
  requestBodyBytes: 1_048_576,
  importBodyBytes: 52_428_800,
} as const;

/**
 * Glyphs a marker can show, drawn by the web app. Plain shapes and everyday symbols only:
 * nothing here names or depicts anything from a game.
 */
export const MAP_ICONS = [
  'pin',
  'dot',
  'star',
  'flag',
  'question',
  'exclamation',
  'door',
  'key',
  'chest',
  'person',
  'house',
  'tree',
  'water',
  'mountain',
  'cross',
  'eye',
  'heart',
  'diamond',
  'bolt',
  'cave',
] as const;
export type MapIcon = (typeof MAP_ICONS)[number];

/** Named colours for drawings and pins, resolved per theme by the web app. */
export const MAP_COLORS = ['ink', 'moss', 'sky', 'rose', 'amber', 'plum'] as const;

export interface Season {
  name: string;
  days: number;
}

export interface Calendar {
  seasons: Season[];
}

/**
 * The only game-adjacent default that ships (spec section 5.3): four seasons of 28 days,
 * editable by the user. Nothing else is pre-filled anywhere.
 */
export const DEFAULT_CALENDAR: Calendar = {
  seasons: [
    { name: 'Spring', days: 28 },
    { name: 'Summer', days: 28 },
    { name: 'Fall', days: 28 },
    { name: 'Winter', days: 28 },
  ],
};

export const DEFAULT_PREFS = {
  readingSize: 'comfortable',
  hintDismissed: false,
} as const;

/** Setting keys that may exist in a database. A fresh database holds `calendar` and `meta` only. */
export const SETTING_KEYS = [
  'calendar',
  'currentGameDate',
  'prefs',
  'meta',
  'layout',
  'markerTypes',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const DEFAULT_PORT = 4317;
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
