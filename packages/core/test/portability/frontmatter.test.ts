import { describe, expect, it } from 'vitest';
import { parseNote, serializeFrontmatter } from '../../src/portability/frontmatter.ts';

const ID = '01HZXK7Y3Q9V5N2M4P6R8T0WAB';
const base = { id: ID, title: 'T', tags: ['a', 'b'], favorite: true, created: 1_700_000_000_000, updated: 1_700_000_100_000 };

describe('frontmatter', () => {
  it('round-trips every field and keeps the body byte for byte', () => {
    for (const body of ['', 'plain', '\r\nstarts with crlf\r\n', '---\nnot front matter\n---\n', 'trailing   \n\n', 'é\u0000x']) {
      const p = parseNote(serializeFrontmatter(base) + body);
      expect(p.status).toBe('ok');
      expect(p).toMatchObject({ id: ID, title: 'T', tags: ['a', 'b'], favorite: true, created: base.created, updated: base.updated });
      expect(p.body).toBe(body);
    }
  });
  it('titles with quotes, newlines and unicode survive (JSON-quoted)', () => {
    const title = 'He said "hi"\nline2 \\ ✓  ';
    expect(parseNote(serializeFrontmatter({ ...base, title }) + 'x').title).toBe(title);
  });
  it('no frontmatter: the whole text is the body', () => {
    const p = parseNote('# Hello\n');
    expect(p).toMatchObject({ body: '# Hello\n', status: 'ok', tags: [] });
  });
  it('malformed frontmatter becomes body text and is reported repaired', () => {
    for (const text of ['---\nthis is not yaml\n---\nbody', '---\ntitle: "unterminated\n---\nbody', '---\ntitle: a\ntitle: b\n---\nx', '---\nnever closed\nbody']) {
      const p = parseNote(text);
      expect(p.body).toBe(text);
      expect(p.status).toBe('repaired');
      expect(p.title).toBeUndefined();
    }
  });
  it('unknown keys keep the whole block in the body while known keys still apply', () => {
    const text = '---\ntitle: "Known"\nlayout: post\n---\nbody';
    const p = parseNote(text);
    expect(p.title).toBe('Known');
    expect(p.body).toBe(text);
  });
  it('validates ids, dates, title and tag limits', () => {
    const p = parseNote(`---\nid: nope\ncreated: yesterday\nupdated: 2026-01-02T03:04:05Z\ntags: ["${'x'.repeat(150)}"]\n---\nb`);
    expect(p.id).toBeUndefined();
    expect(p.created).toBeUndefined();
    expect(p.updated).toBe(Date.parse('2026-01-02T03:04:05Z'));
    expect(p.tags[0]!.length).toBe(100);
    expect(p.status).toBe('repaired');
    const long = parseNote(`---\ntitle: ${JSON.stringify('y'.repeat(1500))}\n---\n`);
    expect([...long.title!].length).toBe(1000);
  });
  it('accepts block lists and plain/single-quoted scalars', () => {
    const p = parseNote("---\ntitle: 'It''s'\ntags:\n  - one\n  - two\nfavorite: true\n---\nb");
    expect(p).toMatchObject({ title: "It's", tags: ['one', 'two'], favorite: true, body: 'b' });
  });
  it('fuzz: random bytes never throw', () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const parts = ['---\n', '---', '\n', 'title: ', '"', '[', ']', 'tags:', '  - ', "'", ':', '\r\n', 'id: ', 'x'.repeat(70_000), '\u0000', '😀'];
    for (let i = 0; i < 3000; i++) {
      let s = '';
      const n = 1 + Math.floor(rnd() * 12);
      for (let j = 0; j < n; j++) s += parts[Math.floor(rnd() * parts.length)]!;
      expect(() => parseNote(s)).not.toThrow();
    }
  });
});
