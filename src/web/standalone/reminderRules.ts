/**
 * When to remind the person to save a copy of their journal. In the standalone web app the
 * journal lives only in the browser, so a file they download is the one real backup. The rules
 * are kept here, away from the screen, so they can be tested.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A journal that was never exported is left alone for this long, so a first visit is not nagged. */
export const FIRST_REMINDER_AFTER_MS = 3 * DAY_MS;
/** After an export, remind again when it is this old. */
export const REPEAT_REMINDER_AFTER_MS = 14 * DAY_MS;
/** "Remind me later" is quiet for this long. */
export const SNOOZE_MS = 3 * DAY_MS;

export interface ReminderFacts {
  /** Epoch milliseconds. */
  now: number;
  /** Whether the journal holds anything worth saving. */
  hasContent: boolean;
  journalCreatedAt: number | null;
  lastExportAt: number | null;
  snoozedUntil: number | null;
}

export function backupReminderDue(facts: ReminderFacts): boolean {
  const { now, hasContent, journalCreatedAt, lastExportAt, snoozedUntil } = facts;
  if (!hasContent) return false;
  if (snoozedUntil !== null && now < snoozedUntil) return false;
  if (lastExportAt !== null) return now - lastExportAt >= REPEAT_REMINDER_AFTER_MS;
  // Without a creation time, assume the journal is old enough.
  return journalCreatedAt === null || now - journalCreatedAt >= FIRST_REMINDER_AFTER_MS;
}

/** A short description of how long ago, for the message. */
export function describeAge(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days < 1) return 'today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}
