import { toAppError } from '../db/errors.ts';
import { err, type AppErrorCode, type Result } from '../result.ts';

/** Thrown inside portability streams; converted to a Result at the public edge (never crosses RPC). */
export class PortError extends Error {
  readonly code: AppErrorCode;
  constructor(code: AppErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.code = code;
  }
}

export const NO_SPACE = 'Not enough disk space. Free some space and try again.';
export const NO_PERMISSION = 'Mossnote has no permission to write there. Choose another location.';
export const CANCELLED = 'Cancelled';

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};

/** Maps anything thrown to a Result. Disk-full and permission errors get a clear message (PT-12). */
export function toPortResult(e: unknown): Result<never> {
  if (e instanceof PortError) return err(e.code, e.message, e.cause);
  const c = codeOf(e);
  if (c === 'ENOSPC' || c === 'EDQUOT' || c === 'SQLITE_FULL') return err('io', NO_SPACE, e);
  if (c === 'EACCES' || c === 'EPERM' || c === 'EROFS') return err('io', NO_PERMISSION, e);
  return toAppError(e);
}

export const corrupt = (what = 'This backup is damaged or is not a Mossnote backup.'): PortError =>
  new PortError('corrupt', what);

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new PortError('unavailable', CANCELLED);
}

export const yieldTick = (): Promise<void> => new Promise((r) => setImmediate(r));
