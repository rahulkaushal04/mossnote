import { describe, expect, it } from 'vitest';
import { resolveJournalId } from './ids';

describe('resolveJournalId', () => {
  it('finds the id that matches exactly', () => {
    expect(resolveJournalId(['alpha', 'work'], 'work')).toBe('work');
  });

  it('finds the existing id when only the case differs, and returns it as it is stored', () => {
    expect(resolveJournalId(['alpha', 'work'], 'WORK')).toBe('work');
    expect(resolveJournalId(['Alpha', 'work'], 'alpha')).toBe('Alpha');
  });

  it('prefers an exact match, so two ids that differ only in case stay separate', () => {
    expect(resolveJournalId(['Foo', 'foo'], 'foo')).toBe('foo');
    expect(resolveJournalId(['Foo', 'foo'], 'Foo')).toBe('Foo');
  });

  it('takes the first of several case-only matches when none is exact', () => {
    expect(resolveJournalId(['Foo', 'foo'], 'FOO')).toBe('Foo');
  });

  it('is null when no journal has that name in any case', () => {
    expect(resolveJournalId(['alpha'], 'beta')).toBeNull();
    expect(resolveJournalId([], 'work')).toBeNull();
  });
});
