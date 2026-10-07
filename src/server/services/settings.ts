import { sql } from 'drizzle-orm';
import { DEFAULT_CALENDAR, DEFAULT_PREFS, type Calendar } from '@shared/constants';
import { decode, isValid } from '@shared/gameDate';
import { calendarSchema } from '@shared/schemas/calendar';
import { layoutSchema } from '@shared/schemas/layout';
import { markerTypesSchema } from '@shared/schemas/map';
import { DEFAULT_LAYOUT } from '@shared/templates';
import {
  currentGameDateSchema,
  metaSchema,
  prefsSchema,
  type Prefs,
  type Settings,
  type SettingsPatch,
} from '@shared/schemas/settings';
import type { Clock } from '../db/backup';
import type { Database } from '../db/client';
import { settings } from '../db/schema';
import { AppError } from '../errors';

const OUTSIDE_CALENDAR = "That date isn't in your calendar.";

function readRaw(database: Database, key: string): unknown {
  const row = database.db
    .select({ value: settings.value })
    .from(settings)
    .where(sql`${settings.key} = ${key}`)
    .get();
  return row ? (JSON.parse(row.value) as unknown) : undefined;
}

function writeRaw(database: Database, key: string, value: unknown, now: number): void {
  const json = JSON.stringify(value);
  database.db
    .insert(settings)
    .values({ key, value: json, updatedAt: new Date(now) })
    .onConflictDoUpdate({ target: settings.key, set: { value: json, updatedAt: new Date(now) } })
    .run();
}

/**
 * Create the rows a fresh journal holds: `calendar` and `meta`, nothing else.
 * Existing rows are never touched, so this is safe to call on every start.
 */
export function ensureSettings(database: Database, journalName: string, clock: Clock): void {
  const now = clock.now();
  database.db.transaction(() => {
    if (readRaw(database, 'calendar') === undefined) {
      writeRaw(database, 'calendar', DEFAULT_CALENDAR, now);
    }
    if (readRaw(database, 'meta') === undefined) {
      writeRaw(database, 'meta', { createdAt: now, journalName }, now);
    }
  });
}

function readCalendar(database: Database): Calendar {
  const raw = readRaw(database, 'calendar');
  return raw === undefined ? DEFAULT_CALENDAR : calendarSchema.parse(raw);
}

export function getSettings(database: Database, journalName: string, clock: Clock): Settings {
  const rawDate = readRaw(database, 'currentGameDate');
  const rawPrefs = readRaw(database, 'prefs');
  const rawMeta = readRaw(database, 'meta');
  const rawLayout = readRaw(database, 'layout');
  const rawMarkers = readRaw(database, 'markerTypes');
  return {
    calendar: readCalendar(database),
    currentGameDate: rawDate === undefined ? null : currentGameDateSchema.parse(rawDate),
    prefs: { ...DEFAULT_PREFS, ...(rawPrefs === undefined ? {} : prefsSchema.parse(rawPrefs)) },
    markerTypes: rawMarkers === undefined ? [] : markerTypesSchema.parse(rawMarkers),
    layout: rawLayout === undefined ? DEFAULT_LAYOUT : layoutSchema.parse(rawLayout),
    meta:
      rawMeta === undefined ? { createdAt: clock.now(), journalName } : metaSchema.parse(rawMeta),
  };
}

interface DateUse {
  kind: 'notes' | 'plantings';
  key: number;
  count: number;
}

/** One query per stored game-date column. Literal SQL only: no string building. */
const DATE_QUERIES: { kind: DateUse['kind']; sql: string }[] = [
  {
    kind: 'notes',
    sql: 'SELECT game_date AS key, count(*) AS count FROM notes WHERE game_date IS NOT NULL GROUP BY game_date',
  },
  {
    kind: 'notes',
    sql: 'SELECT solved_game_date AS key, count(*) AS count FROM notes WHERE solved_game_date IS NOT NULL GROUP BY solved_game_date',
  },
  {
    kind: 'plantings',
    sql: 'SELECT planted_on AS key, count(*) AS count FROM plantings WHERE planted_on IS NOT NULL GROUP BY planted_on',
  },
  {
    kind: 'plantings',
    sql: 'SELECT harvested_on AS key, count(*) AS count FROM plantings WHERE harvested_on IS NOT NULL GROUP BY harvested_on',
  },
];

/** Every distinct stored game date and how many rows use it (soft-deleted rows included). */
function storedDates(database: Database): DateUse[] {
  const uses: DateUse[] = [];
  for (const { kind, sql: query } of DATE_QUERIES) {
    const rows = database.sqlite.prepare(query).all() as { key: number; count: number }[];
    for (const row of rows) uses.push({ kind, key: row.key, count: row.count });
  }
  return uses;
}

export interface CalendarConflict {
  seasonIndex: number;
  season: string;
  reason: 'day_removed' | 'season_removed';
  /** Highest day in use beyond the new limit (or the highest day in use for a removed season). */
  highestDay: number;
  notes: number;
  plantings: number;
}

/** Stored dates that would no longer exist under `next`, grouped by season. */
export function findCalendarConflicts(
  database: Database,
  current: Calendar,
  next: Calendar,
): CalendarConflict[] {
  const bySeason = new Map<number, CalendarConflict>();
  for (const use of storedDates(database)) {
    if (isValid(use.key, next)) continue;
    const { season, day } = decode(use.key);
    const removed = season >= next.seasons.length;
    const existing = bySeason.get(season) ?? {
      seasonIndex: season,
      season: current.seasons[season]?.name ?? `Season ${season + 1}`,
      reason: removed ? ('season_removed' as const) : ('day_removed' as const),
      highestDay: 0,
      notes: 0,
      plantings: 0,
    };
    existing.highestDay = Math.max(existing.highestDay, day);
    existing[use.kind] += use.count;
    bySeason.set(season, existing);
  }
  return [...bySeason.values()].sort((a, b) => a.seasonIndex - b.seasonIndex);
}

function conflictMessage(conflict: CalendarConflict): string {
  const total = conflict.notes + conflict.plantings;
  const noun =
    conflict.plantings === 0
      ? total === 1
        ? 'note uses'
        : 'notes use'
      : total === 1
        ? 'record uses'
        : 'records use';
  return conflict.reason === 'season_removed'
    ? `${total} ${noun} ${conflict.season}, which would be removed.`
    : `${total} ${noun} day ${conflict.highestDay} of ${conflict.season}.`;
}

function mergePrefs(database: Database, patch: Partial<Prefs>): Prefs {
  const raw = readRaw(database, 'prefs');
  const current = { ...DEFAULT_PREFS, ...(raw === undefined ? {} : prefsSchema.parse(raw)) };
  return prefsSchema.parse({ ...current, ...patch });
}

/**
 * Apply a settings patch in one transaction.
 * A calendar that would invalidate stored dates, or the current game date, is refused with
 * 409 `conflict` and counts; nothing is rewritten.
 */
export function updateSettings(
  database: Database,
  journalName: string,
  clock: Clock,
  patch: SettingsPatch,
  /** Runs inside the transaction when season names changed, to refresh the search index. */
  onCalendarRenamed?: () => void,
): Settings {
  const now = clock.now();
  database.db.transaction(() => {
    const before = getSettings(database, journalName, clock);
    const calendar = patch.calendar ?? before.calendar;
    const currentGameDate =
      patch.currentGameDate === undefined ? before.currentGameDate : patch.currentGameDate;

    if (patch.currentGameDate != null && !isValid(patch.currentGameDate, calendar)) {
      throw new AppError('validation_failed', OUTSIDE_CALENDAR, {
        fields: { currentGameDate: OUTSIDE_CALENDAR },
      });
    }

    if (patch.calendar) {
      const conflicts = findCalendarConflicts(database, before.calendar, patch.calendar);
      const currentBreaks = currentGameDate !== null && !isValid(currentGameDate, calendar);
      if (conflicts.length > 0 || currentBreaks) {
        const first = conflicts[0];
        throw new AppError(
          'conflict',
          first ? conflictMessage(first) : "The current date isn't in that calendar.",
          {
            details: {
              conflicts,
              affected: {
                notes: conflicts.reduce((n, c) => n + c.notes, 0),
                plantings: conflicts.reduce((n, c) => n + c.plantings, 0),
                currentGameDate: currentBreaks,
              },
            },
          },
        );
      }
      writeRaw(database, 'calendar', patch.calendar, now);
      const names = (c: Calendar) => c.seasons.map((x) => x.name).join('\u0000');
      if (names(before.calendar) !== names(patch.calendar)) onCalendarRenamed?.();
    }
    if (patch.currentGameDate !== undefined) {
      writeRaw(database, 'currentGameDate', patch.currentGameDate, now);
    }
    if (patch.prefs) writeRaw(database, 'prefs', mergePrefs(database, patch.prefs), now);
    if (patch.layout) writeRaw(database, 'layout', patch.layout, now);
    if (patch.markerTypes) writeRaw(database, 'markerTypes', patch.markerTypes, now);
  });
  return getSettings(database, journalName, clock);
}

/** Store one setting value (used by import, which replaces the journal's settings). */
export function setSetting(database: Database, key: string, value: unknown, clock: Clock): void {
  writeRaw(database, key, value, clock.now());
}
