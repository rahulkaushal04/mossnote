import { JOURNAL_PATTERN } from '@shared/journalId';

/**
 * Where things are in the pool. Names are absolute paths, as the browser's file system wants
 * them. Journals and snapshots sit in separate folders so neither can be mistaken for the other.
 */

export const CATALOG_FILE = '/catalog.db';
const JOURNALS_DIRECTORY = '/journals/';
export const BACKUPS_DIRECTORY = '/backups/';

export const journalFile = (id: string): string => `${JOURNALS_DIRECTORY}${id}.db`;
export const snapshotFile = (name: string): string => `${BACKUPS_DIRECTORY}${name}`;

/** The journal id for a pool file name, or null when it is not a journal file. */
export function journalIdOfFile(file: string): string | null {
  if (!file.startsWith(JOURNALS_DIRECTORY) || !file.endsWith('.db')) return null;
  const id = file.slice(JOURNALS_DIRECTORY.length, -'.db'.length);
  return JOURNAL_PATTERN.test(id) ? id : null;
}

/** The snapshot name for a pool file name, or null when it is not a snapshot file. */
export function snapshotNameOfFile(file: string): string | null {
  return file.startsWith(BACKUPS_DIRECTORY) ? file.slice(BACKUPS_DIRECTORY.length) : null;
}
