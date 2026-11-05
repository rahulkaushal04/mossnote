import type { Reply } from '@mossnote/core/rpc';

// core/rpc does not re-export these named types, so they are derived from the method replies.
export type AttachmentRef = Reply<'attachments.addPath'>;
export type AttachmentInfo = Reply<'attachments.info'>;
export type CleanupPreview = Reply<'attachments.cleanupPreview'>;
export type CleanupResult = Reply<'attachments.cleanupRun'>;
export type VerifyReport = Reply<'attachments.verifyAll'>;
export type Kind = AttachmentRef['kind'];

export const MIB = 1024 * 1024;

export function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MIB) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * MIB) return `${(n / MIB).toFixed(1)} MB`;
  return `${(n / (1024 * MIB)).toFixed(2)} GB`;
}

/** The one-line toast for a verifyAll report (AT-2). */
export function verifySummary(r: VerifyReport): string {
  const bad = r.missing.length + r.corrupt.length;
  const extra = r.untracked.length
    ? ` ${r.untracked.length} unused file(s) can be cleaned up.`
    : '';
  if (bad === 0) return `Checked ${r.checked} attachment(s): all are intact.${extra}`;
  const parts = [
    r.missing.length ? `${r.missing.length} missing` : '',
    r.corrupt.length ? `${r.corrupt.length} damaged` : '',
  ].filter(Boolean);
  return `Checked ${r.checked} attachment(s): ${parts.join(', ')}. Restore the affected files from a backup.${extra}`;
}

export const DAMAGED_MESSAGE = 'This file is damaged or missing. Restore it from a backup.';
