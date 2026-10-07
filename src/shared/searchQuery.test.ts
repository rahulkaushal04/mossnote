import { describe, expect, it } from 'vitest';
import { COUNTER_CALENDAR, DEFAULT_CALENDAR, type Calendar } from './constants';
import { hasCriteria, parseSearch, removeChip } from './searchQuery';

const cal = DEFAULT_CALENDAR;
const parse = (q: string, calendar: Calendar = cal) => parseSearch(q, calendar);
const texts = (q: string) => parse(q).terms.map((t) => (t.phrase ? `"${t.text}"` : t.text));

describe('words, phrases and exclusions', () => {
  it('splits words on whitespace', () => {
    expect(texts('harbour lantern')).toEqual(['harbour', 'lantern']);
  });
  it('keeps a quoted phrase together', () => {
    expect(texts('"quiet corner" lantern')).toEqual(['"quiet corner"', 'lantern']);
  });
  it('treats -word and -"phrase" as exclusions', () => {
    const p = parse('lantern -draft -"old corner"');
    expect(p.terms.map((t) => t.text)).toEqual(['lantern']);
    expect(p.excluded.map((t) => t.text)).toEqual(['draft', 'old corner']);
  });
  it('treats a lone dash and a dash inside a word as text', () => {
    expect(texts('- well-known')).toEqual(['-', 'well-known']);
  });
  it('closes an unterminated quote at the end', () => {
    expect(texts('"half open')).toEqual(['"half open"']);
  });
  it('trims and caps the query at 200 characters', () => {
    expect(parse('   x   ').raw).toBe('x');
    expect(parse('a'.repeat(500)).raw).toHaveLength(200);
  });
  it('an empty query has no criteria', () => {
    expect(hasCriteria(parse(''))).toBe(false);
    expect(hasCriteria(parse('   '))).toBe(false);
  });
});

describe('tags, people, flags and kinds', () => {
  it('parses #tag and @Name', () => {
    const p = parse('#idea @Sam lantern');
    expect(p.tags).toEqual(['idea']);
    expect(p.people).toEqual(['Sam']);
    expect(p.terms.map((t) => t.text)).toEqual(['lantern']);
  });
  it('parses @"Full Name"', () => {
    expect(parse('@"Example Person" x').people).toEqual(['Example Person']);
  });
  it('parses is: filters', () => {
    const p = parse('is:question is:open is:discovery is:solved');
    expect(p.flags).toEqual({ discovery: true, question: true, open: true, solved: true });
  });
  it('treats an unknown is: or other prefix as ordinary text', () => {
    expect(texts('is:banana foo:bar')).toEqual(['is:banana', 'foo:bar']);
    expect(parse('is:banana').flags).toEqual({
      discovery: false,
      question: false,
      open: false,
      solved: false,
    });
  });
  it('parses in: kinds', () => {
    expect(parse('in:people lantern').kinds).toEqual(['people']);
    expect(parse('in:notes in:farm').kinds).toEqual(['notes', 'farm']);
    expect(parse('in:nowhere').kinds).toBeNull();
  });
  it('is case-insensitive for operators', () => {
    expect(parse('IS:Question').flags.question).toBe(true);
  });
});

describe('game dates', () => {
  it('parses a season with a day', () => {
    const p = parse('spring 3');
    expect(p.date).toEqual({ season: 0, day: 3 });
    expect(p.terms).toEqual([]);
  });
  it('parses the year forms in either position', () => {
    expect(parse('y2 summer').date).toEqual({ season: 1, year: 2 });
    expect(parse('year 1 fall 12').date).toEqual({ season: 2, day: 12, year: 1 });
    expect(parse('fall 12 year 1').date).toEqual({ season: 2, day: 12, year: 1 });
    expect(parse('winter y3').date).toEqual({ season: 3, year: 3 });
  });
  it('accepts a prefix of at least three letters', () => {
    expect(parse('win 4').date).toEqual({ season: 3, day: 4 });
    expect(parse('su 4').date).toBeNull();
  });
  it('a bare number and unrelated words stay text', () => {
    expect(texts('3 lantern')).toEqual(['3', 'lantern']);
    expect(parse('lantern 3').date).toBeNull();
  });
  it('combines with text', () => {
    const p = parse('spring 3 lantern');
    expect(p.date).toEqual({ season: 0, day: 3 });
    expect(p.terms.map((t) => t.text)).toEqual(['lantern']);
  });
  it('ignores a day outside the season (it stays text)', () => {
    const p = parse('spring 40');
    expect(p.date).toEqual({ season: 0 });
    expect(p.terms.map((t) => t.text)).toEqual(['40']);
  });
  it('follows a renamed or multi-word calendar', () => {
    const calendar: Calendar = {
      seasons: [
        { name: 'Thaw', days: 10 },
        { name: 'Late Bloom', days: 5 },
      ],
    };
    expect(parse('thaw 3', calendar).date).toEqual({ season: 0, day: 3 });
    expect(parse('late bloom 2 y4', calendar).date).toEqual({ season: 1, day: 2, year: 4 });
    expect(parse('spring', calendar).date).toBeNull();
  });
  it('treats an out-of-range year as text, not a date', () => {
    const p = parse('spring y0');
    expect(p.date).toBeNull();
    expect(p.terms.map((t) => t.text)).toEqual(['spring', 'y0']);
  });
});

describe('chips', () => {
  it('lists recognised tokens in query order with their spans', () => {
    const q = 'lantern #idea is:open spring 3';
    const p = parse(q);
    expect(p.chips.map((c) => `${c.type}:${c.label}`)).toEqual([
      'tag:#idea',
      'is:is:open',
      'date:Spring 3',
    ]);
    expect(q.slice(...(p.chips[0]?.spans[0] ?? [0, 0]))).toBe('#idea');
  });
  it('removing a chip removes exactly its text', () => {
    const q = 'lantern #idea is:open spring 3 y2';
    const p = parse(q);
    const date = p.chips.find((c) => c.type === 'date');
    expect(date?.label).toBe('Spring 3 · Year 2');
    expect(removeChip(q, date ?? p.chips[0]!)).toBe('lantern #idea is:open');
    const tag = p.chips.find((c) => c.type === 'tag');
    expect(removeChip(q, tag ?? p.chips[0]!)).toBe('lantern is:open spring 3 y2');
  });
});

describe('game dates in a day counter calendar', () => {
  const counter = COUNTER_CALENDAR;

  it('reads "day 120" as that exact day and leaves the other words as text', () => {
    const p = parse('lantern day 120', counter);
    expect(p.date).toEqual({ year: 2, season: 0, day: 21 });
    expect(p.terms.map((t) => t.text)).toEqual(['lantern']);
    expect(p.chips.map((c) => c.label)).toContain('Day 120');
  });

  it('treats a bare number, a season name and an out-of-range day as plain text', () => {
    expect(parse('120', counter).date).toBeNull();
    expect(parse('spring 3', counter).date).toBeNull();
    expect(parse('day 0', counter).date).toBeNull();
  });
});
