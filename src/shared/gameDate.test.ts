import { describe, expect, it } from 'vitest';
import { COUNTER_CALENDAR, DEFAULT_CALENDAR, LIMITS, type Calendar } from './constants';
import {
  COUNTER_MAX,
  advance,
  dayNumber,
  decode,
  encode,
  format,
  fromDayNumber,
  isValid,
  parse,
} from './gameDate';

const cal = DEFAULT_CALENDAR;
const uneven: Calendar = {
  seasons: [
    { name: 'Alpha', days: 10 },
    { name: 'Beta Gamma', days: 30 },
    { name: 'Alder', days: 5 },
  ],
};
const k = (year: number, season: number, day: number) => encode({ year, season, day });

describe('encode and decode', () => {
  it('uses year*10000 + season*100 + day', () => {
    expect(encode({ year: 1, season: 0, day: 3 })).toBe(10_003);
    expect(encode({ year: 2, season: 3, day: 28 })).toBe(20_328);
  });
  it('round-trips', () => {
    for (const parts of [
      { year: 1, season: 0, day: 1 },
      { year: 99_999, season: 11, day: 99 },
      { year: 17, season: 2, day: 9 },
    ]) {
      expect(decode(encode(parts))).toEqual(parts);
    }
  });
});

describe('isValid', () => {
  it('accepts every day boundary of the default calendar', () => {
    expect(isValid(k(1, 0, 1), cal)).toBe(true);
    expect(isValid(k(1, 3, 28), cal)).toBe(true);
    expect(isValid(k(99_999, 3, 28), cal)).toBe(true);
  });
  it('rejects out-of-calendar values', () => {
    expect(isValid(k(1, 0, 0), cal)).toBe(false);
    expect(isValid(k(1, 0, 29), cal)).toBe(false);
    expect(isValid(k(1, 4, 1), cal)).toBe(false);
    expect(isValid(k(0, 0, 1), cal)).toBe(false);
    expect(isValid(k(100_000, 0, 1), cal)).toBe(false);
  });
  it('rejects non-integers and non-numbers', () => {
    expect(isValid(10_001.5, cal)).toBe(false);
    expect(isValid('10001', cal)).toBe(false);
    expect(isValid(null, cal)).toBe(false);
    expect(isValid(Number.NaN, cal)).toBe(false);
    expect(isValid(-10_001, cal)).toBe(false);
  });
  it('follows calendar edits', () => {
    expect(isValid(k(1, 0, 28), uneven)).toBe(false);
    expect(isValid(k(1, 1, 30), uneven)).toBe(true);
    expect(isValid(k(1, 2, 5), uneven)).toBe(true);
    expect(isValid(k(1, 2, 6), uneven)).toBe(false);
  });
});

describe('advance: rollovers', () => {
  it('moves within a season', () => {
    expect(advance(k(1, 0, 3), cal, 1)).toBe(k(1, 0, 4));
  });
  it('rolls from the last day of a season into the next season', () => {
    expect(advance(k(1, 0, 28), cal, 1)).toBe(k(1, 1, 1));
    expect(advance(k(1, 2, 28), cal, 1)).toBe(k(1, 3, 1));
  });
  it('last day of the last season gives day 1 of season 0 next year', () => {
    expect(advance(k(1, 3, 28), cal, 1)).toBe(k(2, 0, 1));
    expect(advance(k(41, 3, 28), cal, 1)).toBe(k(42, 0, 1));
  });
  it('goes back across season and year boundaries', () => {
    expect(advance(k(1, 1, 1), cal, -1)).toBe(k(1, 0, 28));
    expect(advance(k(2, 0, 1), cal, -1)).toBe(k(1, 3, 28));
  });
  it('returns the same date for zero', () => {
    expect(advance(k(3, 2, 9), cal, 0)).toBe(k(3, 2, 9));
  });
  it('moves many days at once', () => {
    expect(advance(k(1, 0, 1), cal, 112)).toBe(k(2, 0, 1));
    expect(advance(k(1, 0, 1), cal, 111)).toBe(k(1, 3, 28));
    expect(advance(k(1, 0, 1), cal, 112 * 10 + 30)).toBe(k(11, 1, 3));
    expect(advance(k(11, 1, 3), cal, -(112 * 10 + 30))).toBe(k(1, 0, 1));
  });
  it('round-trips forward then back', () => {
    for (const n of [1, 27, 28, 29, 111, 112, 113, 400]) {
      const forward = advance(k(5, 1, 14), cal, n);
      expect(forward).not.toBeNull();
      expect(advance(forward ?? 0, cal, -n)).toBe(k(5, 1, 14));
    }
  });
});

describe('advance: limits', () => {
  it('refuses to go before year 1, season 0, day 1', () => {
    expect(advance(k(1, 0, 1), cal, -1)).toBeNull();
    expect(advance(k(1, 0, 2), cal, -2)).toBeNull();
    expect(advance(k(1, 0, 2), cal, -1)).toBe(k(1, 0, 1));
  });
  it('refuses to go past year 99,999', () => {
    expect(advance(k(99_999, 3, 28), cal, 1)).toBeNull();
    expect(advance(k(99_999, 3, 27), cal, 1)).toBe(k(99_999, 3, 28));
  });
  it('returns null for an invalid key or a non-integer step', () => {
    expect(advance(k(1, 0, 29), cal, 1)).toBeNull();
    expect(advance(k(1, 0, 1), cal, 0.5)).toBeNull();
    expect(advance(k(1, 0, 1), cal, Number.NaN)).toBeNull();
  });
});

describe('advance: calendar edits', () => {
  it('uses the edited season lengths', () => {
    expect(advance(k(1, 0, 10), uneven, 1)).toBe(k(1, 1, 1));
    expect(advance(k(1, 1, 30), uneven, 1)).toBe(k(1, 2, 1));
    expect(advance(k(1, 2, 5), uneven, 1)).toBe(k(2, 0, 1));
    expect(advance(k(2, 0, 1), uneven, -1)).toBe(k(1, 2, 5));
  });
  it('handles a one-season, one-day calendar', () => {
    const tiny: Calendar = { seasons: [{ name: 'Only', days: 1 }] };
    expect(advance(k(1, 0, 1), tiny, 1)).toBe(k(2, 0, 1));
    expect(advance(k(2, 0, 1), tiny, -1)).toBe(k(1, 0, 1));
  });
  it('handles twelve seasons of 99 days', () => {
    const big: Calendar = {
      seasons: Array.from({ length: 12 }, (_, i) => ({ name: `S${i}`, days: 99 })),
    };
    expect(advance(k(1, 11, 99), big, 1)).toBe(k(2, 0, 1));
  });
  it('renaming a season changes labels only, never keys', () => {
    const renamed: Calendar = {
      seasons: cal.seasons.map((s, i) => (i === 0 ? { ...s, name: 'Thaw' } : s)),
    };
    const key = k(1, 0, 3);
    expect(isValid(key, renamed)).toBe(true);
    expect(advance(key, renamed, 1)).toBe(advance(key, cal, 1));
    expect(format(key, cal)).toBe('Spring 3');
    expect(format(key, renamed)).toBe('Thaw 3');
  });
  it('labels follow the calendar for every date', () => {
    const renamed: Calendar = { seasons: cal.seasons.map((s) => ({ ...s, name: `${s.name}x` })) };
    expect(format(k(2, 3, 9), renamed, { withYear: true })).toBe('Winterx 9 · Year 2');
  });
});

describe('format', () => {
  it('formats with and without the year', () => {
    expect(format(k(1, 0, 3), cal)).toBe('Spring 3');
    expect(format(k(1, 0, 3), cal, { withYear: true })).toBe('Spring 3 · Year 1');
  });
  it('returns null when the key is not in the calendar', () => {
    expect(format(k(1, 4, 1), cal)).toBeNull();
    expect(format(k(1, 0, 29), cal)).toBeNull();
  });
});

describe('parse', () => {
  it('parses season and day', () => {
    expect(parse('spring 3', cal)).toEqual({ season: 0, day: 3 });
    expect(parse('Fall 12', cal)).toEqual({ season: 2, day: 12 });
  });
  it('parses a season alone', () => {
    expect(parse('summer', cal)).toEqual({ season: 1 });
  });
  it('parses the year in either position and either form', () => {
    expect(parse('y2 summer', cal)).toEqual({ year: 2, season: 1 });
    expect(parse('summer y2', cal)).toEqual({ year: 2, season: 1 });
    expect(parse('year 1 fall 12', cal)).toEqual({ year: 1, season: 2, day: 12 });
    expect(parse('fall 12 year 1', cal)).toEqual({ year: 1, season: 2, day: 12 });
  });
  it('accepts a prefix of at least three letters', () => {
    expect(parse('win 4', cal)).toEqual({ season: 3, day: 4 });
    expect(parse('sum', cal)).toEqual({ season: 1 });
  });
  it('rejects prefixes shorter than three letters', () => {
    expect(parse('su 4', cal)).toBeNull();
  });
  it('rejects an ambiguous prefix but accepts an exact name', () => {
    expect(parse('al 3', uneven)).toBeNull();
    expect(parse('alp 3', uneven)).toEqual({ season: 0, day: 3 });
    expect(parse('alder 3', uneven)).toEqual({ season: 2, day: 3 });
    expect(parse('ald', uneven)).toEqual({ season: 2 });
    expect(parse('alpha', uneven)).toEqual({ season: 0 });
  });
  it('rejects an ambiguous three-letter prefix', () => {
    const twins: Calendar = {
      seasons: [
        { name: 'Sunrise', days: 5 },
        { name: 'Sunset', days: 5 },
      ],
    };
    expect(parse('sun 2', twins)).toBeNull();
    expect(parse('sunr 2', twins)).toEqual({ season: 0, day: 2 });
  });
  it('matches season names that contain spaces', () => {
    expect(parse('beta gamma 12', uneven)).toEqual({ season: 1, day: 12 });
    expect(parse('y3 beta gamma', uneven)).toEqual({ year: 3, season: 1 });
  });
  it('rejects days outside the season and years outside the range', () => {
    expect(parse('spring 29', cal)).toBeNull();
    expect(parse('spring 0', cal)).toBeNull();
    expect(parse('y0 spring', cal)).toBeNull();
    expect(parse('y100000 spring', cal)).toBeNull();
  });
  it('rejects text that is not a date', () => {
    expect(parse('', cal)).toBeNull();
    expect(parse('3', cal)).toBeNull();
    expect(parse('y2', cal)).toBeNull();
    expect(parse('spring 3 4', cal)).toBeNull();
    expect(parse('spring lantern', cal)).toBeNull();
    expect(parse('year', cal)).toBeNull();
    expect(parse('y1 y2 spring', cal)).toBeNull();
  });
  it('reads the output of format back', () => {
    const text = format(k(4, 2, 17), cal, { withYear: true }) ?? '';
    expect(parse(text, cal)).toEqual({ year: 4, season: 2, day: 17 });
  });
});

describe('a day counter calendar', () => {
  const counter = COUNTER_CALENDAR;

  it('numbers days from 1 and has no seasons or years to show', () => {
    expect(fromDayNumber(1)).toBe(k(1, 0, 1));
    expect(fromDayNumber(99)).toBe(k(1, 0, 99));
    expect(fromDayNumber(100)).toBe(k(2, 0, 1));
    expect(format(k(1, 0, 12), counter)).toBe('Day 12');
    expect(format(k(2, 0, 1), counter, { withYear: true })).toBe('Day 100');
    expect(format(k(1, 1, 1), counter)).toBeNull();
  });

  it('round-trips every day number across the rollover and at both ends', () => {
    for (const n of [1, 2, 98, 99, 100, 101, 198, 199, 12_345, COUNTER_MAX]) {
      const key = fromDayNumber(n);
      expect(key).not.toBeNull();
      expect(isValid(key, counter)).toBe(true);
      expect(dayNumber(key ?? 0)).toBe(n);
    }
    expect(fromDayNumber(0)).toBeNull();
    expect(fromDayNumber(COUNTER_MAX + 1)).toBeNull();
    expect(fromDayNumber(1.5)).toBeNull();
    expect(COUNTER_MAX).toBe(LIMITS.yearMax * 99);
  });

  it('steps forward and back one day at a time without noticing the stored year', () => {
    expect(advance(k(1, 0, 99), counter, 1)).toBe(k(2, 0, 1));
    expect(advance(k(2, 0, 1), counter, -1)).toBe(k(1, 0, 99));
    expect(advance(k(1, 0, 1), counter, -1)).toBeNull();
    expect(advance(fromDayNumber(COUNTER_MAX) ?? 0, counter, 1)).toBeNull();
  });

  it('reads "day 12", "d12" and "12" as one exact day, and nothing else', () => {
    expect(parse('day 120', counter)).toEqual({ year: 2, season: 0, day: 21 });
    expect(parse('Day 5', counter)).toEqual({ year: 1, season: 0, day: 5 });
    expect(parse('d5', counter)).toEqual({ year: 1, season: 0, day: 5 });
    expect(parse('5', counter)).toEqual({ year: 1, season: 0, day: 5 });
    expect(parse('day 0', counter)).toBeNull();
    expect(parse('spring 3', counter)).toBeNull();
    expect(parse('day 12 and more', counter)).toBeNull();
  });
});
