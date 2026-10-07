import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Journal tables. Column names are camelCase here and snake_case in SQL (the Drizzle
 * `casing: 'snake_case'` option is set in db/client.ts and drizzle.config.ts).
 * No game-specific column, enum or default exists, and no seed data is ever inserted.
 */

const timestamp = () => integer({ mode: 'timestamp_ms' });

export const notes = sqliteTable(
  'notes',
  {
    id: text().primaryKey(),
    title: text(),
    body: text().notNull().default(''),
    gameDate: integer(),
    isDiscovery: integer({ mode: 'boolean' }).notNull().default(false),
    questionState: text({ enum: ['open', 'solved'] }),
    resolution: text(),
    solvedGameDate: integer(),
    solvedAt: timestamp(),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => [
    index('notes_timeline_idx').on(t.deletedAt, t.gameDate, t.createdAt),
    index('notes_discovery_idx')
      .on(t.createdAt)
      .where(sql`${t.isDiscovery} = 1 AND ${t.deletedAt} IS NULL`),
    index('notes_question_idx')
      .on(t.questionState, t.createdAt)
      .where(sql`${t.questionState} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    check('notes_has_content', sql`trim(coalesce(${t.title}, '')) <> '' OR trim(${t.body}) <> ''`),
    check('notes_title_length', sql`${t.title} IS NULL OR length(${t.title}) <= 200`),
    check('notes_body_length', sql`length(${t.body}) <= 50000`),
    check('notes_is_discovery_bool', sql`${t.isDiscovery} IN (0, 1)`),
    check(
      'notes_question_state_valid',
      sql`${t.questionState} IS NULL OR ${t.questionState} IN ('open', 'solved')`,
    ),
    check(
      'notes_resolution_needs_question',
      sql`${t.resolution} IS NULL OR ${t.questionState} IS NOT NULL`,
    ),
    check(
      'notes_resolution_length',
      sql`${t.resolution} IS NULL OR length(${t.resolution}) <= 2000`,
    ),
    check(
      'notes_solved_fields_need_solved',
      sql`(${t.solvedGameDate} IS NULL AND ${t.solvedAt} IS NULL) OR ${t.questionState} = 'solved'`,
    ),
  ],
);

export const tags = sqliteTable(
  'tags',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    nameKey: text().notNull(),
    pinned: integer({ mode: 'boolean' }).notNull().default(false),
    createdAt: timestamp().notNull(),
  },
  (t) => [
    uniqueIndex('tags_name_key_unique').on(t.nameKey),
    check('tags_name_length', sql`length(${t.name}) BETWEEN 1 AND 40`),
    check('tags_pinned_bool', sql`${t.pinned} IN (0, 1)`),
  ],
);

export const people = sqliteTable(
  'people',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    notes: text().notNull().default(''),
    progress: integer(),
    progressMax: integer(),
    customFields: text().notNull().default('[]'),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => [
    index('people_name_idx')
      .on(sql`${t.name} COLLATE NOCASE`)
      .where(sql`${t.deletedAt} IS NULL`),
    check('people_name_valid', sql`length(${t.name}) BETWEEN 1 AND 80 AND trim(${t.name}) <> ''`),
    check('people_notes_length', sql`length(${t.notes}) <= 20000`),
    check(
      'people_progress_max_range',
      sql`${t.progressMax} IS NULL OR ${t.progressMax} BETWEEN 1 AND 99`,
    ),
    check(
      'people_progress_valid',
      sql`${t.progress} IS NULL OR (${t.progressMax} IS NOT NULL AND ${t.progress} BETWEEN 0 AND ${t.progressMax})`,
    ),
  ],
);

export const plantings = sqliteTable(
  'plantings',
  {
    id: text().primaryKey(),
    label: text().notNull(),
    plantedOn: integer(),
    harvestedOn: integer(),
    plantedCount: integer(),
    harvestedCount: integer(),
    notes: text().notNull().default(''),
    customFields: text().notNull().default('[]'),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => [
    index('plantings_planted_idx').on(t.deletedAt, t.plantedOn),
    index('plantings_label_idx').on(sql`${t.label} COLLATE NOCASE`),
    check(
      'plantings_label_valid',
      sql`length(${t.label}) BETWEEN 1 AND 80 AND trim(${t.label}) <> ''`,
    ),
    check('plantings_notes_length', sql`length(${t.notes}) <= 20000`),
    check(
      'plantings_planted_count_range',
      sql`${t.plantedCount} IS NULL OR ${t.plantedCount} BETWEEN 0 AND 999999`,
    ),
    check(
      'plantings_harvested_count_range',
      sql`${t.harvestedCount} IS NULL OR ${t.harvestedCount} BETWEEN 0 AND 999999`,
    ),
    check(
      'plantings_harvest_not_before_planting',
      sql`${t.plantedOn} IS NULL OR ${t.harvestedOn} IS NULL OR ${t.harvestedOn} >= ${t.plantedOn}`,
    ),
  ],
);

export const noteTags = sqliteTable(
  'note_tags',
  {
    noteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    tagId: text()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] }), index('note_tags_tag_idx').on(t.tagId)],
);

export const personTags = sqliteTable(
  'person_tags',
  {
    personId: text()
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    tagId: text()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.personId, t.tagId] }), index('person_tags_tag_idx').on(t.tagId)],
);

export const plantingTags = sqliteTable(
  'planting_tags',
  {
    plantingId: text()
      .notNull()
      .references(() => plantings.id, { onDelete: 'cascade' }),
    tagId: text()
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.plantingId, t.tagId] }),
    index('planting_tags_tag_idx').on(t.tagId),
  ],
);

export const links = sqliteTable(
  'links',
  {
    id: text().primaryKey(),
    sourceNoteId: text()
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    targetNoteId: text().references(() => notes.id, { onDelete: 'cascade' }),
    targetPersonId: text().references(() => people.id, { onDelete: 'cascade' }),
    targetPlantingId: text().references(() => plantings.id, { onDelete: 'cascade' }),
    createdAt: timestamp().notNull(),
  },
  (t) => [
    check(
      'links_exactly_one_target',
      sql`(${t.targetNoteId} IS NOT NULL) + (${t.targetPersonId} IS NOT NULL) + (${t.targetPlantingId} IS NOT NULL) = 1`,
    ),
    check('links_not_self', sql`${t.sourceNoteId} <> ${t.targetNoteId}`),
    uniqueIndex('links_note_unique')
      .on(t.sourceNoteId, t.targetNoteId)
      .where(sql`${t.targetNoteId} IS NOT NULL`),
    uniqueIndex('links_person_unique')
      .on(t.sourceNoteId, t.targetPersonId)
      .where(sql`${t.targetPersonId} IS NOT NULL`),
    uniqueIndex('links_planting_unique')
      .on(t.sourceNoteId, t.targetPlantingId)
      .where(sql`${t.targetPlantingId} IS NOT NULL`),
    index('links_target_note_idx').on(t.targetNoteId),
    index('links_target_person_idx').on(t.targetPersonId),
    index('links_target_planting_idx').on(t.targetPlantingId),
  ],
);

export const maps = sqliteTable(
  'maps',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    /** JSON array of drawn shapes, validated by `mapSceneSchema`. Pins are rows, not shapes. */
    scene: text().notNull().default('[]'),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
    deletedAt: timestamp(),
  },
  (t) => [
    index('maps_updated_idx').on(t.deletedAt, t.updatedAt),
    check('maps_name_valid', sql`length(${t.name}) BETWEEN 1 AND 80 AND trim(${t.name}) <> ''`),
    check('maps_scene_length', sql`length(${t.scene}) <= 900000`),
  ],
);

export const mapPins = sqliteTable(
  'map_pins',
  {
    id: text().primaryKey(),
    mapId: text()
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    x: real().notNull(),
    y: real().notNull(),
    label: text().notNull().default(''),
    color: text().notNull().default('moss'),
    note: text().notNull().default(''),
    /** JSON: marker type, icon, status, tags, custom fields, layer, lock, hide, group. */
    props: text().notNull().default('{}'),
    targetNoteId: text().references(() => notes.id, { onDelete: 'set null' }),
    targetPersonId: text().references(() => people.id, { onDelete: 'set null' }),
    targetPlantingId: text().references(() => plantings.id, { onDelete: 'set null' }),
    createdAt: timestamp().notNull(),
    updatedAt: timestamp().notNull(),
  },
  (t) => [
    index('map_pins_map_idx').on(t.mapId),
    index('map_pins_note_idx').on(t.targetNoteId),
    index('map_pins_person_idx').on(t.targetPersonId),
    index('map_pins_planting_idx').on(t.targetPlantingId),
    check('map_pins_label_length', sql`length(${t.label}) <= 80`),
    check('map_pins_note_length', sql`length(${t.note}) <= 5000`),
    check(
      'map_pins_one_target',
      sql`(${t.targetNoteId} IS NOT NULL) + (${t.targetPersonId} IS NOT NULL) + (${t.targetPlantingId} IS NOT NULL) <= 1`,
    ),
  ],
);

export const mapVersions = sqliteTable(
  'map_versions',
  {
    id: text().primaryKey(),
    mapId: text()
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    /** Set for a version the user saved on purpose. */
    name: text(),
    kind: text({ enum: ['auto', 'manual', 'restore'] }).notNull(),
    /** JSON `{ scene, pins }`: everything needed to put the map back as it was. */
    snapshot: text().notNull(),
    createdAt: timestamp().notNull(),
  },
  (t) => [
    index('map_versions_map_idx').on(t.mapId, t.createdAt),
    check('map_versions_name_length', sql`${t.name} IS NULL OR length(${t.name}) <= 60`),
  ],
);

export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  /** JSON, validated by zod on read and write. */
  value: text().notNull(),
  updatedAt: timestamp().notNull(),
});
