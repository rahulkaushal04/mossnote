import { z } from 'zod';
import { LIMITS, type Calendar } from '../constants';
import { encode, isValid, type GameDateParts } from '../gameDate';
import { normalizeTag } from '../tags';
import { cleanText, formatCount } from '../text';
import { calendarSchema } from './calendar';
import { customFieldsSchema, ulidSchema } from './common';
import { layoutSchema } from './layout';
import { mapColorSchema, markerTypesSchema, pinPropsSchema, readScene } from './map';

/** The newest export format this build can read (spec section 17). */
export const CURRENT_FORMAT_VERSION = 1;

const exportedDate = z
  .object({
    year: z.number().int().min(1).max(LIMITS.yearMax),
    season: z.number().int().min(0).max(99),
    day: z.number().int().min(1).max(99),
    /** Included for readability and ignored on import. */
    seasonName: z.string().optional(),
  })
  .strip();

const timestamp = z.iso.datetime({ message: 'Use an ISO 8601 date and time.' });

const text = (max: number, label = 'Too long') =>
  z
    .string()
    .transform(cleanText)
    .refine((s) => s.length <= max, `${label}: more than ${formatCount(max)} characters.`);

const name = (max: number) =>
  z
    .string()
    .transform((s) => cleanText(s).trim())
    .refine((s) => s.length >= 1 && s.length <= max, `Names need 1 to ${max} characters.`);

const linkSchema = z
  .object({ type: z.enum(['note', 'person', 'planting']), id: ulidSchema })
  .strip();

const questionSchema = z
  .object({
    state: z.enum(['open', 'solved']),
    resolution: text(LIMITS.resolution).nullable(),
    solvedGameDate: exportedDate.nullable(),
    solvedAt: timestamp.nullable(),
  })
  .strip();

const noteSchema = z
  .object({
    id: ulidSchema,
    title: text(LIMITS.noteTitle).nullable(),
    body: text(LIMITS.noteBody),
    gameDate: exportedDate.nullable(),
    isDiscovery: z.boolean(),
    question: questionSchema.nullable(),
    tags: z.array(z.string()),
    links: z.array(linkSchema).max(LIMITS.linksPerNote),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strip();

const personSchema = z
  .object({
    id: ulidSchema,
    name: name(LIMITS.personName),
    notes: text(LIMITS.personNotes),
    progress: z.number().int().min(0).nullable(),
    progressMax: z.number().int().min(1).max(LIMITS.progressMax).nullable(),
    customFields: customFieldsSchema,
    tags: z.array(z.string()),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strip();

const count = z.number().int().min(0).max(LIMITS.count).nullable();

const plantingSchema = z
  .object({
    id: ulidSchema,
    label: name(LIMITS.plantingLabel),
    plantedOn: exportedDate.nullable(),
    harvestedOn: exportedDate.nullable(),
    plantedCount: count,
    harvestedCount: count,
    notes: text(LIMITS.plantingNotes),
    customFields: customFieldsSchema,
    tags: z.array(z.string()),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strip();

const pinSchema = z
  .object({
    id: ulidSchema,
    x: z.number().min(-LIMITS.mapCoord).max(LIMITS.mapCoord),
    y: z.number().min(-LIMITS.mapCoord).max(LIMITS.mapCoord),
    label: text(LIMITS.pinLabel),
    color: mapColorSchema,
    note: text(LIMITS.pinNote),
    props: pinPropsSchema.default({}),
    target: linkSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strip();

const mapSchema = z
  .object({
    id: ulidSchema,
    name: name(LIMITS.mapName),
    /** Older files hold the first, flat scene format; it is converted on the way in. */
    scene: z.unknown().transform((raw) => readScene(raw)),
    pins: z.array(pinSchema).max(LIMITS.pinsPerMap),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strip();

const tagSchema = z
  .object({ id: ulidSchema, name: z.string(), pinned: z.boolean(), createdAt: timestamp })
  .strip();

const baseExportSchema = z
  .object({
    format: z.literal('mossnote'),
    formatVersion: z.number().int().min(1),
    exportedAt: timestamp,
    app: z.object({ name: z.string(), version: z.string() }).strip().optional(),
    journalName: z.string().max(100).default('journal'),
    settings: z
      .object({
        calendar: calendarSchema,
        currentGameDate: exportedDate.nullable(),
        prefs: z
          .object({ readingSize: z.enum(['comfortable', 'large']).default('comfortable') })
          .strip(),
        /** Added with templates; older files keep the default layout. */
        layout: layoutSchema.optional(),
        markerTypes: markerTypesSchema.optional(),
      })
      .strip(),
    tags: z.array(tagSchema),
    people: z.array(personSchema),
    plantings: z.array(plantingSchema),
    notes: z.array(noteSchema),
    /** Added after the first release candidate; older files simply have none. */
    maps: z.array(mapSchema).default([]),
  })
  .strip();

export type ExportFile = z.infer<typeof baseExportSchema>;
export type ExportedDate = z.infer<typeof exportedDate>;

export const toParts = (d: ExportedDate): GameDateParts => ({
  year: d.year,
  season: d.season,
  day: d.day,
});
export const toKey = (d: ExportedDate): number => encode(toParts(d));

/**
 * The checks that need the whole file (spec section 17, rule 3): unique ids per kind, every link
 * target present, tags declared, dates valid in the file's own calendar, progress within its
 * maximum, harvest not before planting.
 */
export const exportSchema = baseExportSchema.superRefine((file, ctx) => {
  const add = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const calendar: Calendar = file.settings.calendar;

  const ids = { note: new Set<string>(), person: new Set<string>(), planting: new Set<string>() };
  const unique = (kind: keyof typeof ids, list: { id: string }[], key: string) => {
    list.forEach((item, i) => {
      if (ids[kind].has(item.id)) add([key, i, 'id'], 'This id is used more than once.');
      ids[kind].add(item.id);
    });
  };
  unique('note', file.notes, 'notes');
  unique('person', file.people, 'people');
  unique('planting', file.plantings, 'plantings');

  const tagKeys = new Set<string>();
  const tagIds = new Set<string>();
  file.tags.forEach((tag, i) => {
    const result = normalizeTag(tag.name);
    if (!result.ok) add(['tags', i, 'name'], result.message);
    else if (tagKeys.has(result.key))
      add(['tags', i, 'name'], 'This tag name is used more than once.');
    else tagKeys.add(result.key);
    if (tagIds.has(tag.id)) add(['tags', i, 'id'], 'This id is used more than once.');
    tagIds.add(tag.id);
  });

  const checkTags = (key: string, i: number, tags: string[]) => {
    if (tags.length > LIMITS.tagsPerRecord)
      add([key, i, 'tags'], 'A record can have up to 30 tags.');
    tags.forEach((tag, j) => {
      const result = normalizeTag(tag);
      if (!result.ok || !tagKeys.has(result.key))
        add([key, i, 'tags', j], 'This tag is not in the tag list.');
    });
  };
  const checkDate = (path: (string | number)[], date: ExportedDate | null) => {
    if (date && !isValid(toKey(date), calendar)) add(path, "That date isn't in your calendar.");
  };

  checkDate(['settings', 'currentGameDate'], file.settings.currentGameDate);

  file.notes.forEach((note, i) => {
    if ((note.title ?? '').trim() === '' && note.body.trim() === '') {
      add(['notes', i, 'body'], 'Write something first.');
    }
    checkDate(['notes', i, 'gameDate'], note.gameDate);
    checkTags('notes', i, note.tags);
    const q = note.question;
    if (q) {
      checkDate(['notes', i, 'question', 'solvedGameDate'], q.solvedGameDate);
      if (q.state === 'open' && (q.solvedGameDate !== null || q.solvedAt !== null)) {
        add(['notes', i, 'question'], 'Only a solved question has a solved date.');
      }
    }
    const seen = new Set<string>();
    note.links.forEach((link, j) => {
      const key = `${link.type}:${link.id}`;
      if (seen.has(key)) add(['notes', i, 'links', j], 'This link is listed more than once.');
      seen.add(key);
      if (link.type === 'note' && link.id === note.id)
        add(['notes', i, 'links', j], "That link can't be added.");
      if (!ids[link.type].has(link.id))
        add(['notes', i, 'links', j], 'This link points at a record that is not in the file.');
    });
  });

  const mapIds = new Set<string>();
  file.maps.forEach((map, i) => {
    if (mapIds.has(map.id)) add(['maps', i, 'id'], 'This id is used more than once.');
    mapIds.add(map.id);
    const pinIds = new Set<string>();
    map.pins.forEach((pin, j) => {
      if (pinIds.has(pin.id)) add(['maps', i, 'pins', j, 'id'], 'This id is used more than once.');
      pinIds.add(pin.id);
      if (pin.target && !ids[pin.target.type].has(pin.target.id)) {
        add(
          ['maps', i, 'pins', j, 'target'],
          'This link points at a record that is not in the file.',
        );
      }
    });
  });

  file.people.forEach((person, i) => {
    checkTags('people', i, person.tags);
    if (person.progress !== null && person.progressMax === null) {
      add(['people', i, 'progress'], 'Progress needs a maximum.');
    } else if (
      person.progress !== null &&
      person.progressMax !== null &&
      person.progress > person.progressMax
    ) {
      add(['people', i, 'progress'], "Progress can't be higher than the maximum.");
    }
  });

  file.plantings.forEach((planting, i) => {
    checkTags('plantings', i, planting.tags);
    checkDate(['plantings', i, 'plantedOn'], planting.plantedOn);
    checkDate(['plantings', i, 'harvestedOn'], planting.harvestedOn);
    if (
      planting.plantedOn &&
      planting.harvestedOn &&
      toKey(planting.harvestedOn) < toKey(planting.plantedOn)
    ) {
      add(['plantings', i, 'harvestedOn'], "Harvest can't be before planting.");
    }
  });
});

/** `notes[12].gameDate` style path for error lists. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const part of path) {
    if (typeof part === 'number') out += `[${part}]`;
    else out += out === '' ? String(part) : `.${String(part)}`;
  }
  return out === '' ? '(file)' : out;
}

export type MigrationResult = { ok: true; data: unknown } | { ok: false; message: string };

/**
 * Bring an export of any supported version up to the current one (spec section 17). Version 1 is
 * the only version, so nothing needs converting yet; a newer file is refused before any change.
 */
export function migrateExport(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "That file isn't a Mossnote export." };
  }
  const file = raw as { format?: unknown; formatVersion?: unknown };
  if (file.format !== 'mossnote')
    return { ok: false, message: "That file isn't a Mossnote export." };
  if (
    typeof file.formatVersion !== 'number' ||
    !Number.isInteger(file.formatVersion) ||
    file.formatVersion < 1
  ) {
    return { ok: false, message: "That file doesn't have a valid format version." };
  }
  if (file.formatVersion > CURRENT_FORMAT_VERSION) {
    return {
      ok: false,
      message: 'This file was made by a newer version of Mossnote. Update the app to open it.',
    };
  }
  return { ok: true, data: raw };
}

/** Keys present in `raw` but dropped by parsing, as `path` strings (reported as warnings). */
export function unknownKeys(
  raw: unknown,
  parsed: unknown,
  path: (string | number)[] = [],
): string[] {
  if (Array.isArray(raw) && Array.isArray(parsed)) {
    return raw.flatMap((item, i) => unknownKeys(item, parsed[i], [...path, i]));
  }
  if (typeof raw === 'object' && raw !== null && typeof parsed === 'object' && parsed !== null) {
    const out: string[] = [];
    for (const [key, value] of Object.entries(raw)) {
      if (!(key in parsed)) out.push(formatPath([...path, key]));
      else
        out.push(...unknownKeys(value, (parsed as Record<string, unknown>)[key], [...path, key]));
    }
    return out;
  }
  return [];
}
