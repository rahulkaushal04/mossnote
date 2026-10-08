// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readJournalTime, writeJournalTime } from './journalTimes';

beforeEach(() => {
  localStorage.clear();
});

describe('journal times', () => {
  it('remembers a time for each journal separately', () => {
    writeJournalTime('moss:test', 'first', 100);
    writeJournalTime('moss:test', 'second', 200);

    expect(readJournalTime('moss:test', 'first')).toBe(100);
    expect(readJournalTime('moss:test', 'second')).toBe(200);
    expect(readJournalTime('moss:test', 'third')).toBeNull();
  });

  it('keeps different purposes apart', () => {
    writeJournalTime('moss:one', 'journal', 1);

    expect(readJournalTime('moss:two', 'journal')).toBeNull();
  });

  it('reads nothing from damaged or unexpected storage', () => {
    localStorage.setItem('moss:test', '{ not json');
    expect(readJournalTime('moss:test', 'journal')).toBeNull();

    localStorage.setItem('moss:test', JSON.stringify({ journal: 'yesterday' }));
    expect(readJournalTime('moss:test', 'journal')).toBeNull();
  });
});
