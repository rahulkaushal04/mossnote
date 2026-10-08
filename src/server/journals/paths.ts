import path from 'node:path';
import { JOURNAL_PATTERN } from '@shared/journalId';

export interface JournalPaths {
  journal: string;
  dbPath: string;
  lockPath: string;
}

/** Where a journal's files sit in the data folder. Journals sit side by side, one file each. */
export function journalPaths(dataDir: string, id: string): JournalPaths {
  return {
    journal: id,
    dbPath: path.join(dataDir, `${id}.db`),
    lockPath: path.join(dataDir, `${id}.lock`),
  };
}

/** The journal id for a file name in the data folder, or null when it is not a journal file. */
export function journalIdOfFile(fileName: string): string | null {
  if (!fileName.endsWith('.db')) return null;
  const id = fileName.slice(0, -'.db'.length);
  return JOURNAL_PATTERN.test(id) ? id : null;
}
