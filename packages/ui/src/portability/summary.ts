import type {
  BackupSummary,
  ImportFileReport,
  JobKind,
  JobResult,
  RpcError,
} from '@mossnote/core/rpc';
import { formatSize } from '../attachments/types';

export const MAX_BULK_SELECT = 10_000;
/** Import report lines shown in the dialog; the full report is a file next to the import. */
export const REPORT_LINES = 20;
export const MIN_PASSPHRASE = 8;

export interface JobProgress {
  jobId: string;
  kind: JobKind;
  phase: string;
  done: number;
  total: number;
}
export interface JobFinal {
  jobId: string;
  kind: JobKind;
  ok: boolean;
  result?: JobResult;
  error?: RpcError;
}

export const KIND_LABEL: Record<JobKind, string> = {
  export: 'Export',
  import: 'Import',
  backup: 'Backup',
  restore: 'Restore',
};
export const BACKUP_KIND: Record<BackupSummary['kind'], string> = {
  auto: 'Automatic',
  manual: 'Manual',
  'pre-migration': 'Before an update',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export { plural };
export const damagedFiles = (n: number): string =>
  `${n} attachment ${n === 1 ? 'file was' : 'files were'} already damaged`;

/** One sentence per finished job. Plain text only: the caller renders it as text. */
export function summarize(f: JobFinal): string {
  if (!f.ok || !f.result) {
    const why = f.error?.message ?? 'unknown error';
    return /cancel/i.test(why)
      ? `${KIND_LABEL[f.kind]} was cancelled.`
      : `${KIND_LABEL[f.kind]} failed: ${why}`;
  }
  const r = f.result;
  switch (r.kind) {
    case 'export':
      return `Exported ${plural(r.notes, 'note')} and ${plural(r.attachments, 'attachment')} to “${r.folderName}”.`;
    case 'import':
      return `${r.resumed ? 'Resumed import' : 'Imported'} into “${r.folderName}”: ${r.added} added, ${r.skipped} skipped, ${r.repaired} repaired.`;
    case 'backup':
      return `Backup saved and checked: ${plural(r.noteCount, 'note')}, ${plural(r.attachments, 'attachment')}, ${formatSize(r.size)}${r.encrypted ? ', encrypted' : ''}.`;
    case 'restore':
      return `Backup from ${r.backupCreatedAt} (${plural(r.noteCount, 'note')}) is ready. Mossnote is restarting.`;
  }
}

export function importLines(files: ImportFileReport[]): {
  shown: ImportFileReport[];
  more: number;
} {
  return { shown: files.slice(0, REPORT_LINES), more: Math.max(0, files.length - REPORT_LINES) };
}

export type Check = { ok: true } | { ok: false; message: string };

/** Empty = no encryption. Never stored: callers clear their state right after the call. */
export function checkPassphrase(pass: string, confirm: string): Check {
  if (pass === '') return { ok: true };
  if (pass.length < MIN_PASSPHRASE)
    return { ok: false, message: `Use at least ${MIN_PASSPHRASE} characters.` };
  if (pass !== confirm) return { ok: false, message: 'The two passphrases do not match.' };
  return { ok: true };
}

export const SCHEDULE_MESSAGE =
  'Interval must be a whole number of hours from 1 to 168, and keep a whole number from 1 to 100.';
export function parseSchedule(
  auto: boolean,
  interval: string,
  keep: string,
): { auto: boolean; intervalHours: number; keep: number } | undefined {
  const whole = /^\d{1,3}$/;
  if (!whole.test(interval.trim()) || !whole.test(keep.trim())) return undefined;
  const i = Number(interval.trim());
  const k = Number(keep.trim());
  return i >= 1 && i <= 168 && k >= 1 && k <= 100 ? { auto, intervalHours: i, keep: k } : undefined;
}

export const dateText = (ms: number): string => new Date(ms).toLocaleString();
