import { decode, format, isCounter } from '@shared/gameDate';
import type { Calendar } from '@shared/constants';
import { CURRENT_FORMAT_VERSION, type ExportFile } from '@shared/schemas/export';
import type { Note, Person, Planting } from '@shared/types';
import type { Ctx } from './ctx';
import { iso } from './ctx';
import { toNotes, type NoteRow } from './notes';
import { toPeople } from './people';
import { pinPropsSchema } from '@shared/schemas/map';
import { isDefaultLayout } from '@shared/templates';
import { parseScene } from './maps';
import { toPlantings } from './plantings';
import { readCalendar } from './search-index';
import { getSettings, journalUses } from './settings';

interface ExportedDate {
  year: number;
  season: number;
  day: number;
}
interface NoteDate extends ExportedDate {
  seasonName: string;
}

const parts = (key: number | null): ExportedDate | null => {
  if (key === null) return null;
  const { year, season, day } = decode(key);
  return { year, season, day };
};

/** The one place that adds `seasonName`, in the export format (notes' game dates). */
const noteDate = (key: number | null, calendar: Calendar): NoteDate | null => {
  const d = parts(key);
  return d ? { ...d, seasonName: calendar.seasons[d.season]?.name ?? '' } : null;
};

const byCreated = <T extends { createdAt: string; id: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

/** Live records of each kind, with their tags and live links. */
export function liveRecords(ctx: Ctx): { notes: Note[]; people: Person[]; plantings: Planting[] } {
  const noteRows = ctx.sqlite
    .prepare('SELECT * FROM notes WHERE deleted_at IS NULL')
    .all() as NoteRow[];
  const personRows = ctx.sqlite
    .prepare('SELECT * FROM people WHERE deleted_at IS NULL')
    .all() as Parameters<typeof toPeople>[1];
  const plantingRows = ctx.sqlite
    .prepare('SELECT * FROM plantings WHERE deleted_at IS NULL')
    .all() as Parameters<typeof toPlantings>[1];
  return {
    notes: byCreated(toNotes(ctx, noteRows)),
    people: byCreated(toPeople(ctx, personRows)),
    plantings: byCreated(toPlantings(ctx, plantingRows)),
  };
}

/**
 * The canonical JSON export: IDs preserved, game dates as `{year, season, day}`,
 * records reference tags by name, soft-deleted records and links to them are dropped, arrays are
 * sorted by creation time then id so exports are deterministic.
 */
interface MapRowDb {
  id: string;
  name: string;
  scene: string;
  created_at: number;
  updated_at: number;
}
interface PinRowDb {
  id: string;
  x: number;
  y: number;
  label: string;
  color: string;
  note: string;
  props: string;
  target_note_id: string | null;
  target_person_id: string | null;
  target_planting_id: string | null;
  created_at: number;
  updated_at: number;
}

const LIVE_NOTE = 'SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL';
const LIVE_PERSON = 'SELECT 1 FROM people WHERE id = ? AND deleted_at IS NULL';
const LIVE_PLANTING = 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NULL';

/** Live maps with every pin. A pin whose target was deleted is exported without the link. */
function liveMaps(ctx: Ctx): ExportFile['maps'] {
  const maps = ctx.sqlite
    .prepare('SELECT * FROM maps WHERE deleted_at IS NULL ORDER BY created_at, id')
    .all() as MapRowDb[];
  return maps.map((m) => {
    const pins = ctx.sqlite
      .prepare('SELECT * FROM map_pins WHERE map_id = ? ORDER BY created_at, id')
      .all(m.id) as PinRowDb[];
    return {
      id: m.id,
      name: m.name,
      scene: parseScene(m.scene),
      pins: pins.map((p) => {
        const alive = (query: string, id: string | null): id is string =>
          id !== null && ctx.sqlite.prepare(query).get(id) !== undefined;
        let target: { type: 'note' | 'person' | 'planting'; id: string } | null = null;
        if (alive(LIVE_NOTE, p.target_note_id)) target = { type: 'note', id: p.target_note_id };
        else if (alive(LIVE_PERSON, p.target_person_id))
          target = { type: 'person', id: p.target_person_id };
        else if (alive(LIVE_PLANTING, p.target_planting_id))
          target = { type: 'planting', id: p.target_planting_id };
        return {
          id: p.id,
          x: p.x,
          y: p.y,
          label: p.label,
          color: p.color,
          note: p.note,
          props: pinPropsSchema.catch({}).parse(JSON.parse(p.props)),
          target,
          createdAt: iso(p.created_at),
          updatedAt: iso(p.updated_at),
        };
      }),
      createdAt: iso(m.created_at),
      updatedAt: iso(m.updated_at),
    };
  });
}

export function buildExport(ctx: Ctx): ExportFile {
  const settings = getSettings(ctx, ctx.config.journal, ctx.clock);
  const calendar = settings.calendar;
  const { notes, people, plantings } = liveRecords(ctx);
  const tags = ctx.sqlite.prepare('SELECT id, name, pinned, created_at FROM tags').all() as {
    id: string;
    name: string;
    pinned: number;
    created_at: number;
  }[];

  return {
    format: 'mossnote',
    formatVersion: CURRENT_FORMAT_VERSION,
    exportedAt: iso(ctx.clock.now()),
    app: { name: 'mossnote', version: ctx.config.version },
    journalName: settings.meta.journalName,
    settings: {
      calendar,
      currentGameDate: parts(settings.currentGameDate),
      prefs: { readingSize: settings.prefs.readingSize },
      ...(isDefaultLayout(settings.layout) ? {} : { layout: settings.layout }),
      ...(settings.markerTypes.length === 0 ? {} : { markerTypes: settings.markerTypes }),
    },
    tags: byCreated(
      tags.map((t) => ({
        id: t.id,
        name: t.name,
        pinned: t.pinned === 1,
        createdAt: iso(t.created_at),
      })),
    ),
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      notes: p.notes,
      progress: p.progress,
      progressMax: p.progressMax,
      customFields: p.customFields,
      tags: p.tags,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    plantings: plantings.map((p) => ({
      id: p.id,
      label: p.label,
      plantedOn: parts(p.plantedOn),
      harvestedOn: parts(p.harvestedOn),
      plantedCount: p.plantedCount,
      harvestedCount: p.harvestedCount,
      notes: p.notes,
      customFields: p.customFields,
      tags: p.tags,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
    maps: liveMaps(ctx),
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      gameDate: noteDate(n.gameDate, calendar),
      isDiscovery: n.isDiscovery,
      question: n.question
        ? {
            state: n.question.state,
            resolution: n.question.resolution,
            solvedGameDate: parts(n.question.solvedGameDate),
            solvedAt: n.question.solvedAt,
          }
        : null,
      tags: n.tags,
      links: n.links
        .map((l) => ({ type: l.type, id: l.id }))
        .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    })),
  };
}

/** Two-space indent, LF line endings, trailing newline. */
export const serializeExport = (file: ExportFile): string => `${JSON.stringify(file, null, 2)}\n`;

const pad = (n: number) => String(n).padStart(2, '0');

/** `mossnote-YYYY-MM-DD-HHmm.json`, in local time. */
export function exportFileName(at: number, extension: 'json' | 'md'): string {
  const d = new Date(at);
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return extension === 'json'
    ? `mossnote-${date}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
    : `mossnote-${date}.md`;
}

// ---------------------------------------------------------------------------
// Markdown (one way, human-readable)
// ---------------------------------------------------------------------------

const MARKS = (n: Note) =>
  [n.isDiscovery ? '✦' : '', n.question ? '?' : ''].filter(Boolean).join(' ');

function noteBlock(n: Note, withMarks = true): string {
  const marks = withMarks ? MARKS(n) : '';
  const lines: string[] = [];
  if (n.title) lines.push(`**${n.title}**${marks ? ` ${marks}` : ''}`);
  else if (marks) lines.push(marks);
  if (n.body) lines.push(n.body);
  const meta = [
    n.tags.length > 0 ? n.tags.map((t) => `#${t}`).join(' ') : '',
    n.links.length > 0
      ? `Linked: ${n.links
          .map((l) => l.label)
          .sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
          .join(', ')}`
      : '',
  ].filter(Boolean);
  if (meta.length > 0) lines.push(meta.join(' · '));
  return lines.join('\n');
}

/**
 * One file, written to read like a log: the journal oldest first (and oldest first within a day),
 * then undated notes, questions, people and farm entries. Empty sections are omitted and bodies
 * are verbatim.
 */
export function buildMarkdown(ctx: Ctx): string {
  const calendar = readCalendar(ctx);
  const { notes, people, plantings } = liveRecords(ctx);
  // A template without a Farm section never mentions it, unless entries from an older file exist.
  const showFarm = journalUses(ctx, 'farm') || plantings.length > 0;
  const out: string[] = ['# Mossnote'];
  const when = new Date(ctx.clock.now());
  out.push(
    `Exported ${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} · ${notes.length} notes · ${people.length} people${showFarm ? ` · ${plantings.length} farm entries` : ''}`,
  );

  const dated = notes
    .filter((n) => n.gameDate !== null)
    .sort(
      (a, b) =>
        (a.gameDate ?? 0) - (b.gameDate ?? 0) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  if (dated.length > 0) {
    out.push('', '## Journal');
    let currentKey: number | null = null;
    for (const n of dated) {
      if (n.gameDate !== currentKey) {
        currentKey = n.gameDate;
        const { year } = decode(n.gameDate ?? 0);
        const day = format(n.gameDate ?? 0, calendar) ?? '';
        out.push('', isCounter(calendar) ? `### ${day}` : `### Year ${year} · ${day}`);
      }
      out.push('', noteBlock(n));
    }
  }
  const undated = notes.filter((n) => n.gameDate === null);
  if (undated.length > 0) {
    out.push('', '## Not dated');
    for (const n of undated) out.push('', noteBlock(n));
  }

  const questions = notes.filter((n) => n.question);
  if (questions.length > 0) {
    out.push('', '## Questions');
    for (const state of ['open', 'solved'] as const) {
      const group = questions.filter((n) => n.question?.state === state);
      if (group.length === 0) continue;
      out.push('', `### ${state === 'open' ? 'Open' : 'Solved'}`);
      for (const n of group) {
        const label = (n.title ?? n.body).split('\n')[0] ?? '';
        const date =
          n.gameDate === null ? '' : ` (${format(n.gameDate, calendar, { withYear: true }) ?? ''})`;
        out.push(`- ${label}${date}`);
        if (n.question?.resolution) out.push(`  Answer: ${n.question.resolution}`);
      }
    }
  }

  if (people.length > 0) {
    out.push('', '## People');
    for (const p of people) {
      out.push('', `### ${p.name}`);
      const meta = [
        p.progressMax === null ? '' : `Progress ${p.progress ?? 0} of ${p.progressMax}`,
        p.tags.map((t) => `#${t}`).join(' '),
      ].filter(Boolean);
      if (meta.length > 0) out.push(meta.join(' · '));
      if (p.notes) out.push(p.notes);
      for (const f of p.customFields) out.push(`- ${f.label}: ${f.value}`);
    }
  }

  if (plantings.length > 0) {
    out.push('', '## Farm');
    for (const p of plantings) {
      const dates = [
        p.plantedOn === null ? '' : `planted ${format(p.plantedOn, calendar) ?? ''}`,
        p.harvestedOn === null ? '' : `harvested ${format(p.harvestedOn, calendar) ?? ''}`,
      ].filter(Boolean);
      const counts = [
        p.plantedCount === null ? '' : `planted ${p.plantedCount}`,
        p.harvestedCount === null ? '' : `harvested ${p.harvestedCount}`,
      ].filter(Boolean);
      const detail = [dates.join(', '), counts.join(', ')].filter(Boolean).join(' · ');
      out.push(`- ${p.label}${detail ? `: ${detail}` : ''}`);
      if (p.tags.length > 0) out.push(`  ${p.tags.map((t) => `#${t}`).join(' ')}`);
      if (p.notes) out.push(`  ${p.notes.replaceAll('\n', '\n  ')}`);
    }
  }

  const maps = liveMaps(ctx);
  if (maps.length > 0) {
    out.push('', '## Maps');
    for (const m of maps) {
      const drawn = m.scene.shapes.length;
      out.push('', `### ${m.name}`);
      if (drawn > 0)
        out.push(`${drawn} ${drawn === 1 ? 'drawing' : 'drawings'} (see the JSON export)`);
      for (const pin of m.pins) {
        const label = pin.label === '' ? 'Unnamed pin' : pin.label;
        out.push(`- ${label}${pin.note ? `: ${pin.note.replaceAll('\n', ' ')}` : ''}`);
      }
    }
  }
  return `${out.join('\n')}\n`;
}
