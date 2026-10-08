import { readStorage, writeStorage } from './storage';

/**
 * A time remembered for each journal in this browser (when it was last exported, until when its
 * backup reminder is quiet). Kept in `localStorage` as one object per purpose, keyed by journal id.
 * It is a convenience: if storage is unavailable or damaged the times simply read as unknown.
 */

type Times = Record<string, number>;

function isTimes(value: unknown): value is Times {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every((entry) => typeof entry === 'number')
  );
}

function readAll(key: string): Times {
  const raw = readStorage(key);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isTimes(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Epoch milliseconds remembered under `key` for this journal, or null. */
export function readJournalTime(key: string, journalId: string): number | null {
  return readAll(key)[journalId] ?? null;
}

export function writeJournalTime(key: string, journalId: string, time: number): void {
  writeStorage(key, JSON.stringify({ ...readAll(key), [journalId]: time }));
}
