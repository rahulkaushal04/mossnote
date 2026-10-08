import { useState } from 'react';
import { DownloadLink } from '../components/DownloadLink';
import { lastExportAt } from '../lib/exports';
import { readJournalTime, writeJournalTime } from '../lib/journalTimes';
import { useActiveJournal } from '../features/journals/hooks';
import { backupReminderDue, describeAge, SNOOZE_MS } from './reminderRules';

const SNOOZE_KEY = 'moss:backupSnooze';

/**
 * Standalone web app only. A reminder to download a copy of the journal, because the browser
 * keeps it on this device alone: clearing the browser's data, or losing the device, would lose it.
 */
export function BackupReminder() {
  const journal = useActiveJournal();
  const [now, setNow] = useState(() => Date.now());
  if (!journal) return null;

  const exportedAt = lastExportAt(journal.id);
  const counts = journal.counts;
  const due = backupReminderDue({
    now,
    hasContent:
      counts !== null && counts.notes + counts.people + counts.plantings + counts.maps > 0,
    journalCreatedAt: journal.createdAt === null ? null : Date.parse(journal.createdAt),
    lastExportAt: exportedAt,
    snoozedUntil: readJournalTime(SNOOZE_KEY, journal.id),
  });
  if (!due) return null;

  return (
    <section
      aria-label="Backup reminder"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface p-3"
    >
      <p className="m-0 min-w-60 flex-1">
        {exportedAt === null
          ? 'This journal is only saved in this browser, and no copy has been downloaded.'
          : `Your last downloaded copy was ${describeAge(now - exportedAt)}.`}{' '}
        Download one now and keep it somewhere safe, so clearing the browser can&apos;t take your
        notes with it.
      </p>
      <DownloadLink
        className="btn btn-primary tap no-underline"
        path="/api/data/export.json"
        journalId={journal.id}
      >
        Download a copy
      </DownloadLink>
      <button
        type="button"
        className="btn tap"
        onClick={() => {
          writeJournalTime(SNOOZE_KEY, journal.id, Date.now() + SNOOZE_MS);
          setNow(Date.now());
        }}
      >
        Remind me later
      </button>
    </section>
  );
}
