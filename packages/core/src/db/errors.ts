import { err, type Result } from '../result.ts';

const code = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};

/** Maps thrown driver/fs errors to AppError; the cause is always kept. */
export function toAppError(e: unknown): Result<never> {
  const c = code(e);
  const msg = e instanceof Error ? e.message : String(e);
  if (c === 'SQLITE_FULL' || c.startsWith('SQLITE_IOERR') || c === 'ENOSPC' || c === 'EIO')
    return err('io', `Disk error: ${msg}`, e);
  if (c.startsWith('SQLITE_CORRUPT') || c === 'SQLITE_NOTADB')
    return err('corrupt', `Database is corrupt: ${msg}`, e);
  if (c.startsWith('SQLITE_BUSY') || c.startsWith('SQLITE_LOCKED'))
    return err('unavailable', 'workspace in use', e);
  if (c.startsWith('SQLITE_CONSTRAINT')) return err('conflict', msg, e);
  if (e instanceof Error && e.name === 'ZodError') return err('validation', msg, e);
  return err('internal', msg, e);
}
