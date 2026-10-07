import type { LinkRef, LinkType } from '@shared/types';
import { firstChars } from '@shared/text';
import { validationFailed } from '../errors';
import { inTx, type Ctx } from './ctx';

export interface LinkInput {
  type: LinkType;
  id: string;
}

const CANT_LINK = "That link can't be added.";

const TARGET_EXISTS: Record<LinkType, string> = {
  note: 'SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL',
  person: 'SELECT 1 FROM people WHERE id = ? AND deleted_at IS NULL',
  planting: 'SELECT 1 FROM plantings WHERE id = ? AND deleted_at IS NULL',
};
const INSERT: Record<LinkType, string> = {
  note: 'INSERT INTO links (id, source_note_id, target_note_id, created_at) VALUES (?, ?, ?, ?)',
  person:
    'INSERT INTO links (id, source_note_id, target_person_id, created_at) VALUES (?, ?, ?, ?)',
  planting:
    'INSERT INTO links (id, source_note_id, target_planting_id, created_at) VALUES (?, ?, ?, ?)',
};
const DELETE: Record<LinkType, string> = {
  note: 'DELETE FROM links WHERE source_note_id = ? AND target_note_id = ?',
  person: 'DELETE FROM links WHERE source_note_id = ? AND target_person_id = ?',
  planting: 'DELETE FROM links WHERE source_note_id = ? AND target_planting_id = ?',
};

interface LinkRow {
  source: string;
  type: LinkType;
  id: string;
  label: string;
  body: string | null;
}

// Live targets only: a soft-deleted target hides its chip.
const LINKS_FOR = `
  SELECT l.source_note_id AS source, 'note' AS type, n.id AS id, n.title AS label, n.body AS body
    FROM links l JOIN notes n ON n.id = l.target_note_id
    WHERE n.deleted_at IS NULL AND l.source_note_id IN (SELECT value FROM json_each(?))
  UNION ALL
  SELECT l.source_note_id, 'person', p.id, p.name, NULL
    FROM links l JOIN people p ON p.id = l.target_person_id
    WHERE p.deleted_at IS NULL AND l.source_note_id IN (SELECT value FROM json_each(?))
  UNION ALL
  SELECT l.source_note_id, 'planting', pl.id, pl.label, NULL
    FROM links l JOIN plantings pl ON pl.id = l.target_planting_id
    WHERE pl.deleted_at IS NULL AND l.source_note_id IN (SELECT value FROM json_each(?))
  ORDER BY 1`;

export const noteLabel = (title: string | null, body: string): string =>
  title && title.trim() !== '' ? title : firstChars(body);

/** Outgoing links with display labels, keyed by source note id. */
export function linksFor(ctx: Ctx, noteIds: readonly string[]): Map<string, LinkRef[]> {
  const out = new Map<string, LinkRef[]>(noteIds.map((id) => [id, []]));
  if (noteIds.length === 0) return out;
  const json = JSON.stringify(noteIds);
  const rows = ctx.sqlite.prepare(LINKS_FOR).all(json, json, json) as LinkRow[];
  for (const row of rows) {
    const label = row.type === 'note' ? noteLabel(row.label || null, row.body ?? '') : row.label;
    out.get(row.source)?.push({ type: row.type, id: row.id, label });
  }
  return out;
}

const CURRENT = `
  SELECT 'note' AS type, target_note_id AS id FROM links WHERE source_note_id = ? AND target_note_id IS NOT NULL
  UNION ALL SELECT 'person', target_person_id FROM links WHERE source_note_id = ? AND target_person_id IS NOT NULL
  UNION ALL SELECT 'planting', target_planting_id FROM links WHERE source_note_id = ? AND target_planting_id IS NOT NULL`;

/**
 * Replace a note's outgoing links: at most 50, unique, targets exist
 * and are not deleted, a note cannot link to itself. Existing links that stay keep their rows.
 */
export function setLinks(ctx: Ctx, noteId: string, inputs: readonly LinkInput[]): void {
  const seen = new Set<string>();
  const wanted: LinkInput[] = [];
  for (const input of inputs) {
    const key = `${input.type}:${input.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wanted.push(input);
  }
  const fail = () => validationFailed(CANT_LINK, { links: CANT_LINK });
  inTx(ctx, () => {
    const current = ctx.sqlite.prepare(CURRENT).all(noteId, noteId, noteId) as LinkInput[];
    const keep = new Set(current.map((c) => `${c.type}:${c.id}`));
    for (const link of wanted) {
      if (link.type === 'note' && link.id === noteId) throw fail();
      if (
        !keep.has(`${link.type}:${link.id}`) &&
        !ctx.sqlite.prepare(TARGET_EXISTS[link.type]).get(link.id)
      ) {
        throw fail();
      }
    }
    for (const old of current) {
      if (!seen.has(`${old.type}:${old.id}`))
        ctx.sqlite.prepare(DELETE[old.type]).run(noteId, old.id);
    }
    for (const link of wanted) {
      if (keep.has(`${link.type}:${link.id}`)) continue;
      ctx.sqlite.prepare(INSERT[link.type]).run(ctx.newId(), noteId, link.id, ctx.clock.now());
    }
  });
}

/** Live notes that link to a target, as chips (used for "Linked from"). */
export function linkedFromRefs(ctx: Ctx, type: LinkType, id: string): LinkRef[] {
  const rows = ctx.sqlite.prepare(LINKED_FROM[type]).all(id) as {
    id: string;
    title: string | null;
    body: string;
  }[];
  return rows.map((r) => ({ type: 'note' as const, id: r.id, label: noteLabel(r.title, r.body) }));
}

const LINKED_FROM: Record<LinkType, string> = {
  note: `SELECT n.id, n.title, n.body FROM links l JOIN notes n ON n.id = l.source_note_id
         WHERE l.target_note_id = ? AND n.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC`,
  person: `SELECT n.id, n.title, n.body FROM links l JOIN notes n ON n.id = l.source_note_id
         WHERE l.target_person_id = ? AND n.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC`,
  planting: `SELECT n.id, n.title, n.body FROM links l JOIN notes n ON n.id = l.source_note_id
         WHERE l.target_planting_id = ? AND n.deleted_at IS NULL ORDER BY n.created_at DESC, n.id DESC`,
};
