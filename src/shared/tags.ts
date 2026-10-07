import { LIMITS } from './constants';

export type TagResult = { ok: true; name: string; key: string } | { ok: false; message: string };

// Control characters (C0, DEL, C1) are not allowed in tag names.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const FORBIDDEN = /[,#@[\]]/;

/** Lowercased, NFC key used for uniqueness. The first-used casing is the display name. */
export function tagKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}

/**
 * `normalizeTag`: trim, strip leading `#`, whitespace becomes `-`, NFC,
 * 1 to 40 characters, none of `, # @ [ ]` or control characters, and at least one letter or number.
 */
export function normalizeTag(input: string): TagResult {
  let name = input.normalize('NFC').trim().replace(/^#+/, '').trim();
  name = name.replace(/\s+/g, '-');
  if (name.length === 0 || !/[\p{L}\p{N}]/u.test(name)) {
    return { ok: false, message: 'Tags need at least one letter or number.' };
  }
  if (name.length > LIMITS.tagName) {
    return { ok: false, message: 'Tags can be up to 40 characters.' };
  }
  if (CONTROL.test(name) || FORBIDDEN.test(name)) {
    return { ok: false, message: "Tags can't contain , # @ [ ] or control characters." };
  }
  return { ok: true, name, key: tagKey(name) };
}

/**
 * Normalise a list of tag names: invalid names are reported by index, duplicates (by key)
 * collapse keeping the first casing.
 */
export function normalizeTags(inputs: readonly string[]): {
  tags: { name: string; key: string }[];
  errors: { index: number; message: string }[];
} {
  const tags: { name: string; key: string }[] = [];
  const errors: { index: number; message: string }[] = [];
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    const result = normalizeTag(input);
    if (!result.ok) {
      errors.push({ index, message: result.message });
      return;
    }
    if (seen.has(result.key)) return;
    seen.add(result.key);
    tags.push({ name: result.name, key: result.key });
  });
  return { tags, errors };
}

/**
 * Pull a trailing line made only of `#tokens` out of a body. Returns the
 * body without that line and the tag names found. Only the last non-empty line counts.
 */
export function extractTrailingTags(body: string): { body: string; tags: string[] } {
  const lines = body.split('\n');
  let last = lines.length - 1;
  while (last >= 0 && (lines[last] ?? '').trim() === '') last--;
  if (last < 0) return { body, tags: [] };
  const tokens = (lines[last] ?? '').trim().split(/\s+/);
  if (tokens.length === 0 || !tokens.every((t) => /^#[^\s#]+$/.test(t))) return { body, tags: [] };
  const valid = tokens.map((t) => normalizeTag(t));
  if (valid.some((r) => !r.ok)) return { body, tags: [] };
  const rest = lines.slice(0, last).join('\n').replace(/\s+$/, '');
  return { body: rest, tags: valid.map((r) => (r.ok ? r.name : '')) };
}
