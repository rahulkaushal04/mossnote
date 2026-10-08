import { api } from './api';
import { currentJournalId } from './journal';
import { readJournalTime, writeJournalTime } from './journalTimes';
import { saveBlob } from './saveFile';

/**
 * Exporting a journal to a file, and remembering when it last happened. The standalone web app
 * keeps the journal only in the browser, so an exported file is its real backup; the reminder
 * (`BackupReminder`) reads the time recorded here.
 */

const LAST_EXPORT_KEY = 'moss:lastExport';

/** Epoch milliseconds of the last export of this journal, or null if it was never exported. */
export const lastExportAt = (journalId: string): number | null =>
  readJournalTime(LAST_EXPORT_KEY, journalId);

/** Note that a journal was just exported. */
export function recordExport(
  journalId: string | null = currentJournalId(),
  now = Date.now(),
): void {
  if (journalId !== null) writeJournalTime(LAST_EXPORT_KEY, journalId, now);
}

/** Fetch an export from the app and save it as a file. */
export async function downloadExport(path: string, journalId?: string): Promise<void> {
  const { blob, filename } = await api.download(path);
  saveBlob(blob, filename);
  recordExport(journalId);
}
