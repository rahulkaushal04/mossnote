/** Pure search-query parser and FTS5 MATCH builder (SR-5). Never throws. */

export const MAX_QUERY_CHARS = 500;
export const MAX_QUERY_TERMS = 20;

export interface QueryTerm {
  text: string;
  /** Prefix match (`word*`). A quoted phrase is never a prefix. */
  prefix: boolean;
}

export interface ParsedQuery {
  /** Bare words (implicit AND). */
  terms: QueryTerm[];
  /** Quoted phrases (implicit AND with terms). */
  phrases: string[];
  /** `-word` / `-"phrase"` exclusions. */
  excluded: QueryTerm[];
  /** Raw `tag:` values; the caller resolves them. */
  tagFilters: string[];
  /** Raw `folder:` values; the caller resolves them. */
  folderFilters: string[];
  /** Readable notices to show next to the results. */
  messages: string[];
}

// Lone surrogates and control characters (incl. NUL) become spaces.
const BAD_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
const SEARCHABLE = /[\p{L}\p{N}]/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const searchableCount = (s: string): number => s.match(SEARCHABLE)?.length ?? 0;

export function parseQuery(input: string): ParsedQuery {
  const q: ParsedQuery = {
    terms: [],
    phrases: [],
    excluded: [],
    tagFilters: [],
    folderFilters: [],
    messages: [],
  };
  let s = typeof input === 'string' ? input : '';
  if (s.length > MAX_QUERY_CHARS) {
    s = s.slice(0, MAX_QUERY_CHARS);
    q.messages.push(`Search is too long; only the first ${MAX_QUERY_CHARS} characters are used.`);
  }
  s = s.replace(BAD_CHARS, ' ');

  const isSpace = (c: string | undefined): boolean => c === undefined || /\s/u.test(c);
  let count = 0;
  let i = 0;
  while (i < s.length) {
    if (isSpace(s[i])) {
      i++;
      continue;
    }
    if (count >= MAX_QUERY_TERMS) {
      q.messages.push(`Too many search terms; only the first ${MAX_QUERY_TERMS} are used.`);
      break;
    }
    // A lone '-' is plain text (and dropped as unsearchable); '-' before a token excludes it.
    const neg = s[i] === '-' && !isSpace(s[i + 1]);
    if (neg) i++;

    // Reads a quoted run starting at the opening quote; unbalanced runs to the end.
    const readQuoted = (): string => {
      const end = s.indexOf('"', i + 1);
      const value = s.slice(i + 1, end < 0 ? s.length : end);
      if (end < 0)
        q.messages.push('Unbalanced quote: the rest of the query is searched as a phrase.');
      i = end < 0 ? s.length : end + 1;
      return value;
    };
    const readWord = (): string => {
      const from = i;
      while (i < s.length && !isSpace(s[i])) i++;
      return s.slice(from, i);
    };

    if (s[i] === '"') {
      const phrase = readQuoted().trim();
      count++;
      if (searchableCount(phrase) === 0) continue;
      if (neg) q.excluded.push({ text: phrase, prefix: false });
      else q.phrases.push(phrase);
      continue;
    }

    const key = /^(tag|folder):/iu.exec(s.slice(i, i + 7));
    if (key) {
      const name = key[1]!.toLowerCase();
      i += key[0].length;
      const value = (s[i] === '"' ? readQuoted() : readWord()).trim();
      count++;
      if (neg)
        q.messages.push(
          `Excluding ${name === 'tag' ? 'tags' : 'folders'} isn't supported yet; ignored.`,
        );
      else if (searchableCount(value) === 0) q.messages.push(`${name}: needs a name.`);
      else (name === 'tag' ? q.tagFilters : q.folderFilters).push(value);
      continue;
    }

    let word = readWord();
    count++;
    const stars = /\*+$/u.exec(word);
    if (stars) word = word.slice(0, stars.index);
    const n = searchableCount(word);
    if (n === 0) continue;
    // CJK has no word boundaries under unicode61, so it is always a prefix search (SR-8).
    const prefix = (stars !== null && n >= 2) || CJK.test(word);
    (neg ? q.excluded : q.terms).push({ text: word, prefix });
  }

  const nothing =
    !q.terms.length &&
    !q.phrases.length &&
    !q.excluded.length &&
    !q.tagFilters.length &&
    !q.folderFilters.length;
  if (nothing && !q.messages.length) q.messages.push('Type something to search.');
  return q;
}

const quote = (t: string): string => `"${t.replaceAll('"', '""')}"`;
const fts = (t: QueryTerm): string => quote(t.text) + (t.prefix ? '*' : '');

/**
 * Safe MATCH expression: `"a" AND "b"* AND "c d" NOT "x"`. Null when there is no positive term
 * (use toFtsExclude with a NOT IN subquery for exclusion-only queries).
 */
export function toFtsMatch(p: ParsedQuery): string | null {
  const pos = [...p.terms.map(fts), ...p.phrases.map((t) => quote(t))];
  if (!pos.length) return null;
  return [pos.join(' AND '), ...p.excluded.map((t) => `NOT ${fts(t)}`)].join(' ');
}

/** MATCH expression selecting rows that contain ANY excluded term (OR-joined), or null. */
export function toFtsExclude(p: ParsedQuery): string | null {
  return p.excluded.length ? p.excluded.map(fts).join(' OR ') : null;
}
