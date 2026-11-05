/** Filename sanitizer for export (PT-2). Pure; tested by fuzz. */
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PortError } from './errors.ts';

const MAX_BASE_BYTES = 100;
// Controls (C0/C1), path separators and Windows-hostile characters, line/paragraph separators.
// eslint-disable-next-line no-control-regex
const BAD = /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
// Bidi overrides/embeddings/isolates and the invisible direction marks.
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

const byteLen = (s: string): number => Buffer.byteLength(s, 'utf8');

export function cutBytes(s: string, max: number): string {
  let out = '';
  let n = 0;
  for (const ch of s) {
    const b = byteLen(ch);
    if (n + b > max) break;
    out += ch;
    n += b;
  }
  return out;
}

/** One safe path component (no extension handling). Never empty, never `.`/`..`, at most 100 bytes. */
export function sanitizeComponent(raw: string): string {
  let s = String(raw).normalize('NFC').replace(BIDI, '').replace(BAD, '-');
  s = s.replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '');
  if (s === '') s = 'Untitled';
  if (RESERVED.test(s)) s = `_${s}`;
  s = cutBytes(s, MAX_BASE_BYTES).replace(/[ .]+$/, '');
  return s === '' ? 'Untitled' : s;
}

const keyOf = (s: string): string => s.normalize('NFC').toLowerCase();

/**
 * Picks a name unique in one directory (case-insensitively, files and folders share the set).
 * ` (2)`, ` (3)` ... go before the extension.
 */
export function uniqueName(raw: string, ext: string, used: Set<string>): string {
  const base = sanitizeComponent(raw);
  for (let n = 1; ; n++) {
    const cand = n === 1 ? `${base}${ext}` : `${base} (${n})${ext}`;
    const k = keyOf(cand);
    if (!used.has(k)) {
      used.add(k);
      return cand;
    }
  }
}

/** The root directory reserves these names. */
export const reservedRootNames = (): Set<string> => new Set(['_attachments', 'mossnote-export.json']);

/** Defense in depth: the joined path must stay strictly inside `root`. */
export function within(root: string, rel: string): string {
  const abs = resolve(root, rel);
  const r = relative(root, abs);
  if (r === '' || r.startsWith('..') || isAbsolute(r) || !abs.startsWith(resolve(root) + sep))
    throw new PortError('internal', 'Refusing to write outside the export folder.');
  return abs;
}

/** One sanitized file name for a note title (used by tests and the export). */
export const safeNameForExport = (title: string, used: Set<string>): string => uniqueName(title, '.md', used);
