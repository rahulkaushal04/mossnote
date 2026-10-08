import { describe, expect, it } from 'vitest';
import {
  backupReminderDue,
  describeAge,
  FIRST_REMINDER_AFTER_MS,
  REPEAT_REMINDER_AFTER_MS,
  type ReminderFacts,
} from './reminderRules';

const NOW = Date.UTC(2026, 9, 7, 12);

const facts = (overrides: Partial<ReminderFacts> = {}): ReminderFacts => ({
  now: NOW,
  hasContent: true,
  journalCreatedAt: NOW - FIRST_REMINDER_AFTER_MS,
  lastExportAt: null,
  snoozedUntil: null,
  ...overrides,
});

describe('backupReminderDue', () => {
  it('stays quiet for an empty journal', () => {
    expect(backupReminderDue(facts({ hasContent: false }))).toBe(false);
  });

  it('leaves a new journal alone for the first few days', () => {
    expect(backupReminderDue(facts({ journalCreatedAt: NOW - FIRST_REMINDER_AFTER_MS + 1 }))).toBe(
      false,
    );
  });

  it('reminds once a journal that was never exported is a few days old', () => {
    expect(backupReminderDue(facts())).toBe(true);
  });

  it('reminds for a journal of unknown age that was never exported', () => {
    expect(backupReminderDue(facts({ journalCreatedAt: null }))).toBe(true);
  });

  it('stays quiet after a recent export and speaks again when it is old', () => {
    const exported = NOW - REPEAT_REMINDER_AFTER_MS;

    expect(backupReminderDue(facts({ lastExportAt: exported + 1 }))).toBe(false);
    expect(backupReminderDue(facts({ lastExportAt: exported }))).toBe(true);
  });

  it('stays quiet while snoozed, and speaks again after', () => {
    expect(backupReminderDue(facts({ snoozedUntil: NOW + 1 }))).toBe(false);
    expect(backupReminderDue(facts({ snoozedUntil: NOW }))).toBe(true);
  });
});

describe('describeAge', () => {
  it('says today, one day, or several days', () => {
    expect(describeAge(3_600_000)).toBe('today');
    expect(describeAge(86_400_000)).toBe('1 day ago');
    expect(describeAge(5 * 86_400_000)).toBe('5 days ago');
  });
});
