import { describe, expect, it } from 'vitest';
import { extractTrailingTags, normalizeTag, normalizeTags, tagKey } from './tags';

const name = (input: string) => {
  const r = normalizeTag(input);
  return r.ok ? r.name : r.message;
};

describe('normalizeTag', () => {
  it('trims, strips leading #, and joins words with hyphens', () => {
    expect(name('  #idea ')).toBe('idea');
    expect(name('##idea')).toBe('idea');
    expect(name('two words')).toBe('two-words');
    expect(name('a   b \t c')).toBe('a-b-c');
  });

  it('applies Unicode NFC', () => {
    expect(name('café')).toBe('café');
    expect(tagKey('Café')).toBe('café');
  });

  it('keys are lowercase, display keeps the first casing', () => {
    const a = normalizeTag('Idea');
    const b = normalizeTag('#idea');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
    expect(a.ok && a.name).toBe('Idea');
  });

  it('accepts 1 to 40 characters', () => {
    expect(name('a')).toBe('a');
    expect(name('a'.repeat(40))).toBe('a'.repeat(40));
    expect(name('a'.repeat(41))).toBe('Tags can be up to 40 characters.');
  });

  it('rejects punctuation-only and empty tags', () => {
    for (const bad of ['', '#', '###', '---', '!!!', '   ', '#_-']) {
      expect(name(bad), bad).toBe('Tags need at least one letter or number.');
    }
  });

  it('rejects forbidden and control characters', () => {
    for (const bad of ['a,b', 'a@b', 'a[b', 'a]b', 'a#b', 'a\u0000b', 'a\u0007b', 'a\u007fb']) {
      expect(name(bad), JSON.stringify(bad)).toMatch(/can't contain/);
    }
  });

  it('accepts letters and numbers from any script', () => {
    expect(name('テスト')).toBe('テスト');
    expect(name('2nd')).toBe('2nd');
  });
});

describe('normalizeTags', () => {
  it('collapses duplicates by key and reports bad entries by index', () => {
    const { tags, errors } = normalizeTags(['Idea', 'idea', '#IDEA', '!!', 'other']);
    expect(tags.map((t) => t.name)).toEqual(['Idea', 'other']);
    expect(errors).toEqual([{ index: 3, message: 'Tags need at least one letter or number.' }]);
  });
});

describe('extractTrailingTags', () => {
  it('moves a trailing line of #tokens into tags', () => {
    expect(extractTrailingTags('Some text.\n#idea #Two')).toEqual({
      body: 'Some text.',
      tags: ['idea', 'Two'],
    });
  });

  it('ignores trailing blank lines', () => {
    expect(extractTrailingTags('Text\n\n#a\n\n')).toEqual({ body: 'Text', tags: ['a'] });
  });

  it('leaves mixed lines and inline tags alone', () => {
    for (const body of ['Text #idea', 'Text\n#idea and more', '#idea\nText', 'plain']) {
      expect(extractTrailingTags(body)).toEqual({ body, tags: [] });
    }
  });

  it('leaves a body of only tags as tags with an empty body', () => {
    expect(extractTrailingTags('#a #b')).toEqual({ body: '', tags: ['a', 'b'] });
  });

  it('refuses tokens that are not valid tags', () => {
    expect(extractTrailingTags('Text\n#a #!!')).toEqual({ body: 'Text\n#a #!!', tags: [] });
  });
});
