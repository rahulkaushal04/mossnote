import type { Sqlite } from '../db/types';

/** Refresh the vocabulary after this many index writes. */
export const VOCAB_REFRESH_WRITES = 50;

/**
 * In-memory copy of the `search_vocab` terms and their document counts, used for typo tolerance.
 * Read once, then refreshed after 50 index writes or any import.
 */
export class VocabCache {
  private terms: Map<string, number> | null = null;
  private writes = 0;

  /** Record index writes. */
  noteWrites(count = 1): void {
    this.writes += count;
  }

  /** Drop the copy, for example after an import. */
  invalidate(): void {
    this.terms = null;
  }

  get(sqlite: Sqlite): Map<string, number> {
    if (!this.terms || this.writes >= VOCAB_REFRESH_WRITES) {
      const rows = sqlite.prepare('SELECT term, doc FROM search_vocab').all() as {
        term: string;
        doc: number;
      }[];
      this.terms = new Map(rows.map((r) => [r.term, r.doc]));
      this.writes = 0;
    }
    return this.terms;
  }
}
