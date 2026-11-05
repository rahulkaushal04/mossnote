/**
 * The frontmatter subset exported and imported (PT-1, PT-4). The parser never throws: anything it does
 * not understand leaves the text untouched as the body.
 */
import { ULID_RE } from '../changelog/schema.ts';
import { deriveTitle } from '../rpc/title.ts';

export const FM_MAX = 64 * 1024;
export const MAX_TITLE_CHARS = 1000;
export const MAX_TAGS = 1000;
export const MAX_TAG_CHARS = 100;

export interface NoteDoc {
  id: string;
  title: string;
  tags: string[];
  favorite: boolean;
  created: number;
  updated: number;
  body: string;
}

export const iso = (ms: number): string => new Date(ms).toISOString();

/** The exact bytes before the body. Tags arrive already sorted by name key. */
export function serializeFrontmatter(n: Omit<NoteDoc, 'body'>): string {
  return (
    '---\n' +
    `id: ${n.id}\n` +
    `title: ${JSON.stringify(n.title)}\n` +
    `tags: ${JSON.stringify(n.tags)}\n` +
    `favorite: ${n.favorite ? 'true' : 'false'}\n` +
    `created: ${iso(n.created)}\n` +
    `updated: ${iso(n.updated)}\n` +
    '---\n'
  );
}

export interface Parsed {
  body: string;
  id?: string;
  title?: string;
  tags: string[];
  favorite?: boolean;
  created?: number;
  updated?: number;
  /** 'repaired' notes are reported with `reasons`. */
  status: 'ok' | 'repaired';
  reasons: string[];
}

const KNOWN = new Set(['id', 'title', 'tags', 'favorite', 'created', 'updated']);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

function scalar(v: string): unknown {
  const t = v.trim();
  if (t.startsWith('"') || t.startsWith('[')) return JSON.parse(t) as unknown;
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Splits the leading block; undefined when there is none or it never closes within FM_MAX. */
function split(text: string): { lines: string[]; rest: string } | 'none' | 'unclosed' {
  if (!/^---\r?\n/.test(text)) return 'none';
  const head = text.slice(0, FM_MAX + 8);
  let pos = text.indexOf('\n') + 1;
  const lines: string[] = [];
  while (pos <= head.length) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end).replace(/\r$/, '');
    if (line === '---') return { lines, rest: nl === -1 ? '' : text.slice(nl + 1) };
    if (nl === -1) return 'unclosed';
    lines.push(line);
    pos = nl + 1;
  }
  return 'unclosed';
}

export function parseNote(text: string): Parsed {
  const out: Parsed = { body: text, tags: [], status: 'ok', reasons: [] };
  const sp = split(text);
  if (sp === 'none') return out;
  const bad = (reason: string): Parsed => ({ body: text, tags: [], status: 'repaired', reasons: [reason] });
  if (sp === 'unclosed') return bad('malformed frontmatter (never closed)');
  const seen = new Set<string>();
  let unknown = false;
  try {
    const raw: Record<string, unknown> = {};
    for (let i = 0; i < sp.lines.length; i++) {
      const line = sp.lines[i]!;
      if (line.trim() === '') continue;
      const m = /^([A-Za-z_][A-Za-z0-9_-]*):(?:\s+([\s\S]*)|\s*)$/.exec(line);
      if (!m) return bad('malformed frontmatter');
      const key = m[1]!;
      if (seen.has(key)) return bad('malformed frontmatter (duplicate key)');
      seen.add(key);
      let val: unknown = m[2] === undefined || m[2] === '' ? undefined : scalar(m[2]);
      if (val === undefined) {
        const items: string[] = [];
        while (i + 1 < sp.lines.length && /^\s*-\s+/.test(sp.lines[i + 1]!)) {
          i++;
          items.push(String(scalar(sp.lines[i]!.replace(/^\s*-\s+/, ''))));
        }
        val = items.length ? items : '';
      }
      if (KNOWN.has(key)) raw[key] = val;
      else unknown = true;
    }
    out.body = unknown ? text : sp.rest; // unknown keys: the whole block stays visible in the body
    if (typeof raw.id === 'string' && ULID_RE.test(raw.id)) out.id = raw.id;
    if (typeof raw.title === 'string') {
      const cps = [...raw.title];
      if (cps.length > MAX_TITLE_CHARS) {
        out.title = cps.slice(0, MAX_TITLE_CHARS).join('');
        out.status = 'repaired';
        out.reasons.push('title shortened');
      } else out.title = raw.title;
    }
    if (Array.isArray(raw.tags)) {
      const tags = [...new Set(raw.tags.map((t) => String(t).trim()).filter((t) => t !== ''))];
      out.tags = tags.map((t) => [...t].slice(0, MAX_TAG_CHARS).join('')).slice(0, MAX_TAGS);
      if (tags.length > MAX_TAGS || tags.some((t) => [...t].length > MAX_TAG_CHARS)) {
        out.status = 'repaired';
        out.reasons.push('tags shortened');
      }
    }
    if (raw.favorite === true || raw.favorite === 'true') out.favorite = true;
    for (const k of ['created', 'updated'] as const) {
      const v = raw[k];
      if (v === undefined) continue;
      const ms = typeof v === 'string' && ISO_RE.test(v) ? Date.parse(v) : NaN;
      if (Number.isFinite(ms)) out[k] = ms;
      else {
        out.status = 'repaired';
        out.reasons.push(`invalid ${k} date`);
      }
    }
    return out;
  } catch {
    return bad('malformed frontmatter');
  }
}

/** Title for an imported file: frontmatter, else the first line, else the file name. */
export function titleFor(p: Parsed, fileStem: string): string {
  const t = p.title !== undefined && p.title !== '' ? p.title : deriveTitle(p.body) || fileStem;
  return [...t].slice(0, MAX_TITLE_CHARS).join('');
}
