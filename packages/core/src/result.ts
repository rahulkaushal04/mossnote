/** Errors cross module boundaries as values, not exceptions (SPEC.md code style). */
export type AppErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'trashed'
  | 'io'
  | 'corrupt'
  | 'unavailable'
  | 'internal';

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export type Result<T, E = AppError> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = (code: AppErrorCode, message: string, cause?: unknown): Result<never> => ({
  ok: false,
  error: cause === undefined ? { code, message } : { code, message, cause },
});
