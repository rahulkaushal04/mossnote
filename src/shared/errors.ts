/** Error codes and shapes for the JSON API (including `storage_full`). */

export const ERROR_STATUS = {
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  rate_limited: 429,
  internal: 500,
  storage_full: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    /** Extra machine-readable detail, for example `existingId` or affected counts. */
    details?: Record<string, unknown>;
  };
}
