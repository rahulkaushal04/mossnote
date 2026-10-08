import { describe, expect, it } from 'vitest';
import { pickFreeJournalId, slugify } from './journalId';

describe('slugify', () => {
  it('makes a short, file-name-safe id from any name a person might type', () => {
    expect(slugify('My journal')).toBe('my-journal');
    expect(slugify('  Second   playthrough!! ')).toBe('second-playthrough');
    expect(slugify('Crème brûlée')).toBe('creme-brulee');
    expect(slugify('A'.repeat(100))).toHaveLength(30);
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });

  it('never returns an empty or unsafe id', () => {
    for (const name of ['', '   ', '!!!', '日本語', '🎮🎮']) expect(slugify(name)).toBe('journal');
    expect(slugify('x-'.repeat(40))).not.toMatch(/-$/);
  });
});

describe('pickFreeJournalId', () => {
  it('uses the slug when it is free', () => {
    expect(pickFreeJournalId('My journal', () => true)).toBe('my-journal');
  });

  it('numbers the slug until it finds a free id', () => {
    const taken = new Set(['my-journal', 'my-journal-2']);
    expect(pickFreeJournalId('My journal', (id) => !taken.has(id))).toBe('my-journal-3');
  });
});
