import { LIMITS, type Calendar } from './constants';
import { fold } from './text';
import { decode, fromDayNumber, type GameDateQuery } from './gameDate';

/** One word or quoted phrase to match as text. */
export interface SearchTerm {
  text: string;
  phrase: boolean;
}

export type SearchKind = 'notes' | 'people' | 'farm';

/** A recognised token, shown as a removable chip. `spans` are [start, end) offsets in the query. */
export interface SearchChip {
  type: 'tag' | 'person' | 'is' | 'in' | 'date';
  label: string;
  spans: [number, number][];
}

export interface ParsedSearch {
  /** The trimmed, capped query that was parsed. */
  raw: string;
  terms: SearchTerm[];
  excluded: SearchTerm[];
  tags: string[];
  people: string[];
  flags: { discovery: boolean; question: boolean; open: boolean; solved: boolean };
  kinds: SearchKind[] | null;
  date: GameDateQuery | null;
  chips: SearchChip[];
}

interface Token {
  text: string;
  start: number;
  end: number;
  /** A quoted phrase, with the quotes removed. */
  quoted: boolean;
  negated: boolean;
  /** Full text of an @"Full Name" or #tag style token, when recognised. */
  consumed: boolean;
}

const IS_VALUES = ['discovery', 'question', 'open', 'solved'] as const;
const IN_VALUES: Record<string, SearchKind> = { notes: 'notes', people: 'people', farm: 'farm' };

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i] ?? '';
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const start = i;
    let negated = false;
    if (ch === '-' && i + 1 < raw.length && !/\s/.test(raw[i + 1] ?? '')) {
      negated = true;
      i++;
    }
    // `@"Full Name"` keeps its prefix so the person token is recognised later.
    let prefix = '';
    if ((raw[i] === '@' || raw[i] === '#') && raw[i + 1] === '"') {
      prefix = raw[i] ?? '';
      i++;
    }
    if (raw[i] === '"') {
      const close = raw.indexOf('"', i + 1);
      const end = close === -1 ? raw.length : close;
      tokens.push({
        text: `${prefix}${raw.slice(i + 1, end)}`,
        start,
        end: close === -1 ? raw.length : close + 1,
        quoted: prefix === '',
        negated,
        consumed: false,
      });
      i = close === -1 ? raw.length : close + 1;
      continue;
    }
    let end = i;
    while (end < raw.length && !/\s/.test(raw[end] ?? '')) end++;
    tokens.push({ text: raw.slice(i, end), start, end, quoted: false, negated, consumed: false });
    i = end;
  }
  return tokens;
}

function matchSeason(
  words: Token[],
  at: number,
  calendar: Calendar,
): { index: number; width: number } | null {
  const names = calendar.seasons.map((s) => fold(s.name).split(/\s+/));
  const longest = Math.max(...names.map((n) => n.length));
  for (let width = Math.min(longest, words.length - at); width >= 1; width--) {
    const phrase = words
      .slice(at, at + width)
      .map((w) => fold(w.text))
      .join(' ');
    const exact = names.findIndex((n) => n.join(' ') === phrase);
    if (exact !== -1) return { index: exact, width };
  }
  const word = fold(words[at]?.text ?? '');
  if (word.length >= 3 && /^\p{L}+$/u.test(word)) {
    const hits = names
      .map((n, index) => ({ index, name: n.join(' ') }))
      .filter((n) => n.name.startsWith(word));
    if (hits.length === 1 && hits[0]) return { index: hits[0].index, width: 1 };
  }
  return null;
}

function yearAt(words: Token[], at: number): { year: number; width: number } | null {
  const word = fold(words[at]?.text ?? '');
  const compact = /^y(\d{1,5})$/.exec(word);
  if (compact) return { year: Number(compact[1]), width: 1 };
  if (word === 'year') {
    const next = words[at + 1]?.text ?? '';
    if (/^\d{1,5}$/.test(next)) return { year: Number(next), width: 2 };
  }
  return null;
}

/** `day 12` in a day-counter calendar: one exact day, whatever the stored year. */
function extractCounterDate(
  words: Token[],
  calendar: Calendar,
): { date: GameDateQuery; used: Token[]; label: string } | null {
  const name = fold(calendar.seasons[0]?.name ?? 'day');
  for (let at = 0; at + 1 < words.length; at++) {
    const number = words[at + 1]?.text ?? '';
    if (fold(words[at]?.text ?? '') !== name || !/^\d{1,7}$/.test(number)) continue;
    const key = fromDayNumber(Number(number));
    if (key === null) continue;
    const used = words.slice(at, at + 2);
    return { date: decode(key), used, label: `${calendar.seasons[0]?.name ?? 'Day'} ${number}` };
  }
  return null;
}

/**
 * Find a game-date filter among plain words: a season name, or a prefix of at
 * least 3 letters, with an optional day and an optional `y2` or `year 2`. A bare number is text.
 */
function extractDate(
  words: Token[],
  calendar: Calendar,
): { date: GameDateQuery; used: Token[]; label: string } | null {
  if (calendar.counter) return extractCounterDate(words, calendar);
  for (let at = 0; at < words.length; at++) {
    const season = matchSeason(words, at, calendar);
    if (!season) continue;
    const used = words.slice(at, at + season.width);
    const date: GameDateQuery = { season: season.index };
    let cursor = at + season.width;

    const dayToken = words[cursor];
    const days = calendar.seasons[season.index]?.days ?? 0;
    if (
      dayToken &&
      /^\d{1,2}$/.test(dayToken.text) &&
      Number(dayToken.text) >= 1 &&
      Number(dayToken.text) <= days
    ) {
      date.day = Number(dayToken.text);
      used.push(dayToken);
      cursor++;
    }
    const after = yearAt(words, cursor);
    if (after) {
      date.year = after.year;
      used.push(...words.slice(cursor, cursor + after.width));
    } else {
      for (const width of [1, 2]) {
        const before = at - width >= 0 ? yearAt(words, at - width) : null;
        if (before?.width === width) {
          date.year = before.year;
          used.unshift(...words.slice(at - width, at));
          break;
        }
      }
    }
    if (date.year !== undefined && (date.year < 1 || date.year > LIMITS.yearMax)) continue;
    const name = calendar.seasons[season.index]?.name ?? '';
    const label = `${name}${date.day === undefined ? '' : ` ${date.day}`}${
      date.year === undefined ? '' : ` · Year ${date.year}`
    }`;
    return { date, used, label };
  }
  return null;
}

/**
 * Deterministic query parser, shared by the server (matching) and the client
 * (filter chips). Words must all match; quotes make a phrase; `-word` excludes; `#tag`,
 * `@Name`, `is:`, `in:` and game-date tokens are filters. Unknown `word:` prefixes are text.
 */
export function parseSearch(input: string, calendar: Calendar): ParsedSearch {
  const raw = input.normalize('NFC').trim().slice(0, LIMITS.searchQuery);
  const result: ParsedSearch = {
    raw,
    terms: [],
    excluded: [],
    tags: [],
    people: [],
    flags: { discovery: false, question: false, open: false, solved: false },
    kinds: null,
    date: null,
    chips: [],
  };
  const tokens = tokenize(raw);
  const plain: Token[] = [];

  for (const token of tokens) {
    const text = token.text;
    if (token.quoted) {
      if (text.trim())
        (token.negated ? result.excluded : result.terms).push({ text, phrase: true });
      continue;
    }
    if (token.negated) {
      if (text.trim()) result.excluded.push({ text, phrase: false });
      continue;
    }
    const lower = text.toLowerCase();
    if (text.startsWith('#') && text.length > 1) {
      const name = text.slice(1).replace(/^"|"$/g, '');
      result.tags.push(name);
      result.chips.push({ type: 'tag', label: `#${name}`, spans: [[token.start, token.end]] });
      continue;
    }
    if (text.startsWith('@') && text.length > 1) {
      const name = text.slice(1).replace(/^"|"$/g, '');
      result.people.push(name);
      result.chips.push({ type: 'person', label: `@${name}`, spans: [[token.start, token.end]] });
      continue;
    }
    const flag = /^is:(.+)$/.exec(lower)?.[1];
    if (flag && (IS_VALUES as readonly string[]).includes(flag)) {
      result.flags[flag as (typeof IS_VALUES)[number]] = true;
      result.chips.push({ type: 'is', label: `is:${flag}`, spans: [[token.start, token.end]] });
      continue;
    }
    const kind = /^in:(.+)$/.exec(lower)?.[1];
    const kindValue = kind ? IN_VALUES[kind] : undefined;
    if (kind && kindValue) {
      result.kinds = [...(result.kinds ?? []), kindValue];
      result.chips.push({ type: 'in', label: `in:${kind}`, spans: [[token.start, token.end]] });
      continue;
    }
    plain.push(token);
  }

  const date = extractDate(plain, calendar);
  const used = new Set(date?.used ?? []);
  if (date) {
    result.date = date.date;
    result.chips.push({
      type: 'date',
      label: date.label,
      spans: date.used.map((t) => [t.start, t.end] as [number, number]),
    });
  }
  for (const token of plain) {
    if (!used.has(token)) result.terms.push({ text: token.text, phrase: false });
  }
  result.chips.sort((a, b) => (a.spans[0]?.[0] ?? 0) - (b.spans[0]?.[0] ?? 0));
  return result;
}

/** Remove a chip's tokens from a query string (the chip's × control). */
export function removeChip(query: string, chip: SearchChip): string {
  let out = query;
  for (const [start, end] of [...chip.spans].sort((a, b) => b[0] - a[0])) {
    out = `${out.slice(0, start)} ${out.slice(end)}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** True when the parsed query has anything to match or filter on. */
export function hasCriteria(p: ParsedSearch): boolean {
  return (
    p.terms.length > 0 ||
    p.excluded.length > 0 ||
    p.tags.length > 0 ||
    p.people.length > 0 ||
    p.date !== null ||
    Object.values(p.flags).some(Boolean)
  );
}
