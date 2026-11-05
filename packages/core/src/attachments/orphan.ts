import type { Db } from '../db/types.ts';

/**
 * Privacy on purge (decision M10): once the LAST reference to a blob is gone its extracted PDF text
 * must not linger in the database. The file itself stays until the user runs Cleanup (unlink only).
 * Call inside the transaction that deleted the reference rows. The search trigger on attachments.text
 * is a no-op by then (no ref left to refresh).
 */
export function clearOrphanText(db: Db, shas: Iterable<string>): void {
  const q = db.prepare(
    `UPDATE attachments SET text = '', text_state = 'none'
     WHERE sha256 = ? AND (text <> '' OR text_state <> 'none')
       AND NOT EXISTS (SELECT 1 FROM note_attachments WHERE sha256 = ?)`,
  );
  for (const s of new Set(shas)) q.run(s, s);
}
