import { LIMITS, type Calendar } from './constants';

/**
 * In-game dates are one integer key: `year*10000 + seasonIndex*100 + day`
 * (year 1 to 99,999; season index 0 to 99; day 1 to 99).
 */

export interface GameDateParts {
  year: number;
  /** Zero-based season index. */
  season: number;
  day: number;
}

/** A partial date as typed in a search query. Omitted parts mean "any". */
export interface GameDateQuery {
  year?: number;
  season?: number;
  day?: number;
}

export function encode({ year, season, day }: GameDateParts): number {
  return year * 10_000 + season * 100 + day;
}

export function decode(key: number): GameDateParts {
  const year = Math.floor(key / 10_000);
  const rest = key - year * 10_000;
  const season = Math.floor(rest / 100);
  return { year, season, day: rest - season * 100 };
}

/** True when `key` is an integer date that exists under `calendar`. */
export function isValid(key: unknown, calendar: Calendar): key is number {
  if (typeof key !== 'number' || !Number.isInteger(key) || key < 0) return false;
  const { year, season, day } = decode(key);
  if (year < 1 || year > LIMITS.yearMax) return false;
  const s = calendar.seasons[season];
  if (!s) return false;
  return day >= 1 && day <= s.days;
}

/**
 * Move `key` by `n` days (negative goes back), rolling over seasons and years.
 * Returns null when `key` is not valid, `n` is not an integer, or the result would fall before
 * year 1, season 0, day 1 or past year 99,999.
 */
export function advance(key: number, calendar: Calendar, n: number): number | null {
  if (!isValid(key, calendar) || !Number.isInteger(n)) return null;
  const yearLength = calendar.seasons.reduce((sum, s) => sum + s.days, 0);
  const { year, season, day } = decode(key);
  let dayOfYear = day - 1;
  for (let i = 0; i < season; i++) dayOfYear += calendar.seasons[i]?.days ?? 0;

  const total = (year - 1) * yearLength + dayOfYear + n;
  if (total < 0) return null;
  const newYear = Math.floor(total / yearLength) + 1;
  if (newYear > LIMITS.yearMax) return null;

  let remaining = total % yearLength;
  for (let i = 0; i < calendar.seasons.length; i++) {
    const days = calendar.seasons[i]?.days ?? 0;
    if (remaining < days) return encode({ year: newYear, season: i, day: remaining + 1 });
    remaining -= days;
  }
  return null;
}

/**
 * `Spring 3`, or `Spring 3 · Year 1` with `withYear`. Returns null when the key is not valid
 * under the calendar, so callers decide what to show.
 */
export function format(
  key: number,
  calendar: Calendar,
  options: { withYear?: boolean } = {},
): string | null {
  if (!isValid(key, calendar)) return null;
  const { year, season, day } = decode(key);
  const name = calendar.seasons[season]?.name ?? '';
  const base = `${name} ${day}`;
  return options.withYear ? `${base} · Year ${year}` : base;
}

function normalise(text: string): string {
  return text.normalize('NFC').toLowerCase();
}

function matchSeason(
  tokens: string[],
  calendar: Calendar,
): { index: number; start: number; width: number } | null {
  const names = calendar.seasons.map((s) => normalise(s.name).split(/\s+/));
  const longest = Math.max(...names.map((n) => n.length));

  // Exact season names first, longest window first (names may contain spaces).
  for (let width = Math.min(longest, tokens.length); width >= 1; width--) {
    for (let start = 0; start + width <= tokens.length; start++) {
      const phrase = tokens.slice(start, start + width).join(' ');
      const index = names.findIndex((n) => n.join(' ') === phrase);
      if (index !== -1) return { index, start, width };
    }
  }
  // Then a unique prefix of at least 3 letters, as one token.
  for (let start = 0; start < tokens.length; start++) {
    const token = tokens[start] ?? '';
    if (token.length < 3 || !/^\p{L}+$/u.test(token)) continue;
    const hits = names
      .map((n, i) => ({ i, name: n.join(' ') }))
      .filter((n) => n.name.startsWith(token));
    if (hits.length === 1 && hits[0]) return { index: hits[0].i, start, width: 1 };
  }
  return null;
}

/**
 * Parse text such as `spring 3`, `y2 summer`, `year 1 fall 12` or the output of
 * `format(..., { withYear: true })`. A season is required; the day and year are optional and an
 * omitted year means any year. Returns null for anything else, including an ambiguous season
 * prefix or a day that does not exist in that season.
 */
export function parse(text: string, calendar: Calendar): GameDateQuery | null {
  const tokens = normalise(text)
    .replace(/[·,]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return null;

  let year: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? '';
    const compact = /^y(\d+)$/.exec(token);
    if (compact) {
      if (year !== undefined) return null;
      year = Number(compact[1]);
    } else if (token === 'year') {
      const next = tokens[i + 1] ?? '';
      if (year !== undefined || !/^\d+$/.test(next)) return null;
      year = Number(next);
      i++;
    } else {
      rest.push(token);
    }
  }
  if (year !== undefined && (year < 1 || year > LIMITS.yearMax)) return null;

  const season = matchSeason(rest, calendar);
  if (!season) return null;
  const leftover = [...rest.slice(0, season.start), ...rest.slice(season.start + season.width)];

  let day: number | undefined;
  if (leftover.length > 1) return null;
  if (leftover.length === 1) {
    const token = leftover[0] ?? '';
    if (!/^\d+$/.test(token)) return null;
    day = Number(token);
    const days = calendar.seasons[season.index]?.days ?? 0;
    if (day < 1 || day > days) return null;
  }

  const result: GameDateQuery = { season: season.index };
  if (year !== undefined) result.year = year;
  if (day !== undefined) result.day = day;
  return result;
}
