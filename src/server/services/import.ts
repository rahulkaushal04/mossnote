import {
  exportSchema,
  formatPath,
  migrateExport,
  toKey,
  unknownKeys,
  type ExportFile,
} from '@shared/schemas/export';
import { normalizeTag } from '@shared/tags';
import type { ImportSummary } from '@shared/types';
import { createSnapshot } from '../db/backup';
import { AppError } from '../errors';
import { inTx, type Ctx } from './ctx';
import { reindexAll } from './search-index';
import { getSettings, setSetting } from './settings';

type Counts = ImportSummary['counts'];

const countsOf = (file: ExportFile): Counts => ({
  notes: file.notes.length,
  people: file.people.length,
  plantings: file.plantings.length,
  tags: file.tags.length,
  maps: file.maps.length,
});

export type Validated =
  | { ok: true; file: ExportFile; warnings: string[] }
  | { ok: false; errors: ImportSummary['errors'] };

/**
 * Validate an uploaded file with the same limits as the API (spec section 17, rules 1 to 3).
 * Unknown fields are ignored with a warning; nothing is written.
 */
export function validateImport(raw: unknown): Validated {
  const migrated = migrateExport(raw);
  if (!migrated.ok) return { ok: false, errors: [{ path: '(file)', message: migrated.message }] };
  const parsed = exportSchema.safeParse(migrated.data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }
  const warnings = unknownKeys(migrated.data, parsed.data).map(
    (path) => `Ignored unknown field ${path}.`,
  );
  return { ok: true, file: parsed.data, warnings };
}

/** `POST /api/data/import?dryRun=1`: what the file contains, or what is wrong with it. */
export function dryRunImport(raw: unknown): ImportSummary {
  const result = validateImport(raw);
  if (!result.ok) {
    return {
      counts: { notes: 0, people: 0, plantings: 0, tags: 0, maps: 0 },
      warnings: [],
      errors: result.errors,
    };
  }
  return { counts: countsOf(result.file), warnings: result.warnings, errors: [] };
}

const WIPE = [
  'DELETE FROM map_pins',
  'DELETE FROM maps',
  'DELETE FROM links',
  'DELETE FROM note_tags',
  'DELETE FROM person_tags',
  'DELETE FROM planting_tags',
  'DELETE FROM notes',
  'DELETE FROM people',
  'DELETE FROM plantings',
  'DELETE FROM tags',
] as const;

/** Tag names were validated with the file, so normalising cannot fail here. */
function keyOf(name: string): string {
  const result = normalizeTag(name);
  if (!result.ok) throw new Error(result.message);
  return result.key;
}

const ms = (value: string) => Date.parse(value);
const dateKey = (d: { year: number; season: number; day: number } | null) => (d ? toKey(d) : null);

/** Replace everything in one transaction: tags, people, farm entries, notes, joins, links, settings. */
function replaceAll(ctx: Ctx, file: ExportFile): void {
  const { sqlite } = ctx;
  for (const statement of WIPE) sqlite.prepare(statement).run();

  const tagIds = new Map<string, string>();
  const insertTag = sqlite.prepare(
    'INSERT INTO tags (id, name, name_key, pinned, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const tag of file.tags) {
    const key = keyOf(tag.name);
    tagIds.set(key, tag.id);
    insertTag.run(tag.id, tag.name, key, tag.pinned ? 1 : 0, ms(tag.createdAt));
  }
  const tagId = (name: string): string => {
    const id = tagIds.get(keyOf(name));
    if (!id) throw new Error('Unknown tag.');
    return id;
  };

  const insertPerson = sqlite.prepare(
    'INSERT INTO people (id, name, notes, progress, progress_max, custom_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const personTag = sqlite.prepare('INSERT INTO person_tags (person_id, tag_id) VALUES (?, ?)');
  for (const p of file.people) {
    insertPerson.run(
      p.id,
      p.name,
      p.notes,
      p.progress,
      p.progressMax,
      JSON.stringify(p.customFields),
      ms(p.createdAt),
      ms(p.updatedAt),
    );
    for (const name of new Set(p.tags.map(tagId))) personTag.run(p.id, name);
  }

  const insertPlanting = sqlite.prepare(
    `INSERT INTO plantings (id, label, planted_on, harvested_on, planted_count, harvested_count, notes,
       custom_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const plantingTag = sqlite.prepare(
    'INSERT INTO planting_tags (planting_id, tag_id) VALUES (?, ?)',
  );
  for (const p of file.plantings) {
    insertPlanting.run(
      p.id,
      p.label,
      dateKey(p.plantedOn),
      dateKey(p.harvestedOn),
      p.plantedCount,
      p.harvestedCount,
      p.notes,
      JSON.stringify(p.customFields),
      ms(p.createdAt),
      ms(p.updatedAt),
    );
    for (const id of new Set(p.tags.map(tagId))) plantingTag.run(p.id, id);
  }

  const insertNote = sqlite.prepare(
    `INSERT INTO notes (id, title, body, game_date, is_discovery, question_state, resolution,
       solved_game_date, solved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const noteTag = sqlite.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)');
  for (const n of file.notes) {
    const q = n.question;
    insertNote.run(
      n.id,
      n.title,
      n.body,
      dateKey(n.gameDate),
      n.isDiscovery ? 1 : 0,
      q?.state ?? null,
      q?.resolution ?? null,
      q ? dateKey(q.solvedGameDate) : null,
      q?.solvedAt ? ms(q.solvedAt) : null,
      ms(n.createdAt),
      ms(n.updatedAt),
    );
    for (const id of new Set(n.tags.map(tagId))) noteTag.run(n.id, id);
  }
  // Links go in after every note, person and farm entry exists.
  const linkInsert = {
    note: sqlite.prepare(
      'INSERT INTO links (id, source_note_id, target_note_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    person: sqlite.prepare(
      'INSERT INTO links (id, source_note_id, target_person_id, created_at) VALUES (?, ?, ?, ?)',
    ),
    planting: sqlite.prepare(
      'INSERT INTO links (id, source_note_id, target_planting_id, created_at) VALUES (?, ?, ?, ?)',
    ),
  };
  for (const n of file.notes) {
    for (const link of n.links)
      linkInsert[link.type].run(ctx.newId(), n.id, link.id, ms(n.createdAt));
  }

  const insertMap = sqlite.prepare(
    'INSERT INTO maps (id, name, scene, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertPin = sqlite.prepare(
    `INSERT INTO map_pins (id, map_id, x, y, label, color, note, props, target_note_id, target_person_id,
       target_planting_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const m of file.maps) {
    insertMap.run(m.id, m.name, JSON.stringify(m.scene), ms(m.createdAt), ms(m.updatedAt));
    for (const p of m.pins) {
      const t = p.target;
      insertPin.run(
        p.id,
        m.id,
        p.x,
        p.y,
        p.label,
        p.color,
        p.note,
        JSON.stringify(p.props),
        t?.type === 'note' ? t.id : null,
        t?.type === 'person' ? t.id : null,
        t?.type === 'planting' ? t.id : null,
        ms(p.createdAt),
        ms(p.updatedAt),
      );
    }
  }

  const current = getSettings(ctx, ctx.config.journal, ctx.clock);
  setSetting(ctx, 'calendar', file.settings.calendar, ctx.clock);
  setSetting(ctx, 'currentGameDate', dateKey(file.settings.currentGameDate), ctx.clock);
  setSetting(
    ctx,
    'prefs',
    { readingSize: file.settings.prefs.readingSize, hintDismissed: current.prefs.hintDismissed },
    ctx.clock,
  );
  if (file.settings.markerTypes)
    setSetting(ctx, 'markerTypes', file.settings.markerTypes, ctx.clock);
  else sqlite.prepare("DELETE FROM settings WHERE key = 'markerTypes'").run();
  if (file.settings.layout) setSetting(ctx, 'layout', file.settings.layout, ctx.clock);
  else sqlite.prepare("DELETE FROM settings WHERE key = 'layout'").run();
  reindexAll(ctx);
}

export interface ImportResult {
  counts: Counts;
  /** The `pre-import` snapshot taken first. */
  snapshot: string;
}

/**
 * Replace the journal with the contents of a file (spec section 17, rule 5): validate, take a
 * `pre-import` snapshot, then replace everything in one transaction and rebuild the index. Any
 * failure rolls back and leaves the previous journal untouched.
 */
export async function importJournal(ctx: Ctx, raw: unknown): Promise<ImportResult> {
  const result = validateImport(raw);
  if (!result.ok) {
    throw new AppError('validation_failed', "That file can't be imported.", {
      details: { errors: result.errors },
    });
  }
  const snapshot = await createSnapshot({
    sqlite: ctx.sqlite,
    backupsDir: ctx.config.backupsDir,
    journal: ctx.config.journal,
    reason: 'pre-import',
    clock: ctx.clock,
    autoKeep: ctx.config.backupKeep,
  });
  try {
    inTx(ctx, () => {
      replaceAll(ctx, result.file);
    });
  } catch {
    throw new AppError('internal', 'Import failed. Your journal is unchanged.', {
      details: { snapshot: snapshot.name },
    });
  }
  ctx.vocab.invalidate();
  return { counts: countsOf(result.file), snapshot: snapshot.name };
}
