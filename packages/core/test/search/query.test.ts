import { describe, expect, it } from 'vitest';
import { parseQuery, toFtsExclude, toFtsMatch } from '../../src/search/index.ts';

const match = (s: string): string | null => toFtsMatch(parseQuery(s));

/** Independent grammar check: item (( AND | NOT ) item)*, item = "…"(with "" escapes) optionally followed by *. */
function validExpr(e: string): boolean {
  let i = 0;
  const item = (): boolean => {
    if (e[i] !== '"') return false;
    i++;
    for (;;) {
      if (i >= e.length) return false;
      if (e[i] === '"') {
        if (e[i + 1] === '"') i += 2;
        else break;
      } else i++;
    }
    i++;
    if (e[i] === '*') i++;
    return true;
  };
  if (!item()) return false;
  while (i < e.length) {
    const op = e.startsWith(' AND ', i) ? 5 : e.startsWith(' NOT ', i) ? 5 : 0;
    if (!op) return false;
    i += op;
    if (!item()) return false;
  }
  return true;
}

describe('parseQuery syntax (SR-5)', () => {
  it('bare words are AND-ed', () => {
    expect(match('alpha beta')).toBe('"alpha" AND "beta"');
  });
  it('phrases, prefix, exclusion, quoted exclusion', () => {
    expect(match('"red fox" jum* -dog -"lazy cat"')).toBe(
      '"jum"* AND "red fox" NOT "dog" NOT "lazy cat"',
    );
  });
  it('tag and folder filters, quoted values allowed', () => {
    const p = parseQuery('tag:work tag:"to do" folder:"My Notes" x');
    expect(p.tagFilters).toEqual(['work', 'to do']);
    expect(p.folderFilters).toEqual(['My Notes']);
    expect(p.terms).toEqual([{ text: 'x', prefix: false }]);
    expect(toFtsMatch(parseQuery('tag:a'))).toBeNull();
  });
  it('-tag: and -folder: are ignored with a message while the rest runs', () => {
    const p = parseQuery('-tag:x -folder:"a b" hello');
    expect(p.tagFilters).toEqual([]);
    expect(p.folderFilters).toEqual([]);
    expect(p.messages).toHaveLength(2);
    expect(toFtsMatch(p)).toBe('"hello"');
  });
  it('unbalanced quote becomes a phrase with a message', () => {
    const p = parseQuery('a "b c');
    expect(p.phrases).toEqual(['b c']);
    expect(p.messages.length).toBe(1);
  });
  it('empty or blank queries give a message and no match', () => {
    for (const s of ['', '   ', '\t\n']) {
      const p = parseQuery(s);
      expect(toFtsMatch(p)).toBeNull();
      expect(p.messages.length).toBeGreaterThan(0);
    }
  });
  it('a single-letter prefix drops the star; CJK is always a prefix (SR-8)', () => {
    expect(match('a*')).toBe('"a"');
    expect(match('日本語')).toBe('"日本語"*');
  });
  it('caps length and term count with messages', () => {
    const long = parseQuery('word '.repeat(300));
    expect(long.messages.length).toBeGreaterThan(0);
    const many = parseQuery(Array.from({ length: 60 }, (_, i) => `w${i}`).join(' '));
    expect(many.terms).toHaveLength(20);
    expect(many.messages.length).toBeGreaterThan(0);
    expect(parseQuery('x'.repeat(100_000)).terms).toHaveLength(1);
  });
  it('exclusion-only query has no MATCH but an exclude expression', () => {
    const p = parseQuery('-spam -"a b"');
    expect(toFtsMatch(p)).toBeNull();
    expect(toFtsExclude(p)).toBe('"spam" OR "a b"');
  });
});

describe('toFtsMatch safety', () => {
  const hostile = [
    'AND OR NOT NEAR',
    'a OR b',
    'a AND b',
    'NEAR(a b)',
    'title:secret',
    'body:secret OR x',
    '"',
    '""',
    '*',
    '**',
    '-',
    '--x',
    '(',
    ')',
    '{',
    '}',
    '^x',
    '"^x"',
    'a\\b \\',
    'nul\u0000byte',
    'x'.repeat(10_000),
    'café naïve',
    '😀 emoji',
    '日本語 漢字*',
    'שלום עולם',
    'مرحبا بالعالم',
    '\ud800 lone',
    'a"b" c"',
    '"a""b"',
    '- - -',
    'NOT NOT x',
    'x -NOT',
    '* OR *',
  ];
  it.each(hostile)('produces only the quoted grammar for %j', (s) => {
    const m = match(s);
    if (m !== null) expect(validExpr(m)).toBe(true);
  });
  it('operator-only queries have nothing searchable', () => {
    for (const s of [
      'AND OR NOT NEAR'.replace(/\w+/g, '*'),
      '"',
      '*',
      '-',
      '--',
      '(',
      '{',
      '^',
      '()',
    ]) {
      expect(match(s)).toBeNull();
    }
  });
  it('operator words are plain quoted terms', () => {
    expect(match('a OR b')).toBe('"a" AND "OR" AND "b"');
    expect(match('title:secret')).toBe('"title:secret"');
    expect(match('NEAR(a b)')).toBe('"NEAR(a" AND "b)"');
    expect(match('^x')).toBe('"^x"');
  });
  it('doubles embedded quotes', () => {
    expect(match('a"b')).toBe('"a""b"');
  });
  it('strips NUL and control characters', () => {
    expect(match('nul\u0000byte')).toBe('"nul" AND "byte"');
  });
});

// mulberry32
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const FRAGMENTS = [
  '"',
  '*',
  '-',
  ':',
  '(',
  ')',
  '{',
  '^',
  '\\',
  '\u0000',
  '\u0002',
  '\u0003',
  ' ',
  '  ',
  '\n',
  'AND',
  'OR',
  'NOT',
  'NEAR',
  'tag:',
  'folder:',
  '-tag:',
  'title:',
  'a',
  'bc',
  'word',
  '123',
  'é',
  'ñ',
  '日本',
  'こんにちは',
  '한국어',
  '😀',
  'שלום',
  'مرحبا',
  '\ud800',
  '\udc00',
  '‮',
];

describe('fuzz', () => {
  it('10,000 random strings never throw and always yield the safe grammar', () => {
    const r = rng(20261105);
    for (let n = 0; n < 10_000; n++) {
      const len = Math.floor(r() * 25);
      let s = '';
      for (let k = 0; k < len; k++) {
        s +=
          r() < 0.8
            ? FRAGMENTS[Math.floor(r() * FRAGMENTS.length)]!
            : String.fromCharCode(Math.floor(r() * 0x500));
      }
      const m = match(s);
      if (m !== null && !validExpr(m))
        throw new Error(`bad expression for ${JSON.stringify(s)}: ${m}`);
      const p = parseQuery(s);
      if (m === null && p.terms.length + p.phrases.length > 0)
        throw new Error(`lost terms for ${JSON.stringify(s)}`);
    }
  });
});
