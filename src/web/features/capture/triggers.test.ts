import { describe, expect, it } from 'vitest';
import { applyTrigger, detectTrigger, matchCommands } from './triggers';

const at = (text: string, caret = text.length) => detectTrigger(text, caret);

describe('# tags', () => {
  it('opens at line start and after whitespace', () => {
    expect(at('#abc')).toEqual({ kind: 'tag', start: 0, end: 4, query: 'abc' });
    expect(at('hello #ab')).toMatchObject({ kind: 'tag', start: 6, query: 'ab' });
    expect(at('line one\n#x')).toMatchObject({ kind: 'tag', start: 9, query: 'x' });
    expect(at('hello #')).toMatchObject({ kind: 'tag', query: '' });
  });
  it('does not open inside a word', () => {
    expect(at('abc#def')).toBeNull();
    expect(at('issue#12')).toBeNull();
  });
  it('closes once a space follows the tag', () => {
    expect(at('#abc ')).toBeNull();
    expect(at('#abc def')).toBeNull();
  });
  it('uses the caret, not the end of the text', () => {
    expect(at('#abc and more', 4)).toMatchObject({ kind: 'tag', query: 'abc' });
  });
  it('a second # inside the query does not count', () => {
    expect(at('#a#b')).toBeNull();
  });
});

describe('@ people', () => {
  it('opens at line start and after whitespace', () => {
    expect(at('@Na')).toEqual({ kind: 'person', start: 0, end: 3, query: 'Na' });
    expect(at('Met @Sa')).toMatchObject({ kind: 'person', start: 4, query: 'Sa' });
  });
  it('an email address never opens it', () => {
    expect(at('write to someone@example.com')).toBeNull();
    expect(at('a@b')).toBeNull();
    expect(at('mail me@')).toBeNull();
  });
  it('allows a name of up to three words', () => {
    expect(at('@Ann Marie')).toMatchObject({ kind: 'person', query: 'Ann Marie' });
    expect(at('@Ann Marie Lee')).toMatchObject({ kind: 'person', query: 'Ann Marie Lee' });
    expect(at('@one two three four')).toBeNull();
  });
  it('closes on a newline or an over-long query', () => {
    expect(at('@Sam\nnext')).toBeNull();
    expect(at(`@${'x'.repeat(41)}`)).toBeNull();
  });
});

describe('[[ links', () => {
  it('opens anywhere, including mid-word', () => {
    expect(at('see [[ab')).toEqual({ kind: 'link', start: 4, end: 8, query: 'ab' });
    expect(at('see[[x')).toMatchObject({ kind: 'link', query: 'x' });
    expect(at('[[')).toMatchObject({ kind: 'link', query: '' });
  });
  it('allows spaces in the query and closes at ]', () => {
    expect(at('[[two words')).toMatchObject({ query: 'two words' });
    expect(at('[[done]] more')).toBeNull();
  });
  it('does not span lines', () => {
    expect(at('[[abc\ndef')).toBeNull();
  });
});

describe('/ commands', () => {
  it('opens at line start only', () => {
    expect(at('/')).toEqual({ kind: 'command', start: 0, end: 1, query: '' });
    expect(at('/ti')).toMatchObject({ kind: 'command', query: 'ti' });
    expect(at('text\n/di')).toMatchObject({ kind: 'command', start: 5, query: 'di' });
  });
  it('does not open mid-line, in a path, or after a space', () => {
    expect(at('a /title')).toBeNull();
    expect(at('and/or')).toBeNull();
    expect(at('/title now')).toBeNull();
    expect(at(' /title')).toBeNull();
  });
  it('filters the menu by prefix', () => {
    expect(matchCommands('').map((c) => c.id)).toEqual([
      'title',
      'date',
      'discovery',
      'question',
      'tag',
      'person',
      'link',
    ]);
    expect(matchCommands('di').map((c) => c.id)).toEqual(['discovery']);
    expect(matchCommands('D').map((c) => c.id)).toEqual(['date', 'discovery']);
    expect(matchCommands('zzz')).toEqual([]);
  });
});

describe('plain text', () => {
  it('has no trigger', () => {
    expect(at('')).toBeNull();
    expect(at('just words')).toBeNull();
    expect(at('50% off # not a tag?')).toBeNull();
  });
});

describe('applyTrigger', () => {
  it('removes the trigger text and puts the caret where it was', () => {
    const text = 'hello #ab world';
    const trigger = detectTrigger(text, 9);
    expect(trigger).not.toBeNull();
    expect(applyTrigger(text, trigger!)).toEqual({
      text: 'hello  world',
      caret: 6,
    });
  });
  it('replaces it with a name', () => {
    const trigger = detectTrigger('Met @Sa', 7);
    expect(applyTrigger('Met @Sa', trigger!, 'Sam Example')).toEqual({
      text: 'Met Sam Example',
      caret: 15,
    });
  });
});
