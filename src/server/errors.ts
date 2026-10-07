import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from '@shared/errors';

/** A typed error that the error middleware turns into the JSON error shape. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly fields: Record<string, string> | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    extra: { fields?: Record<string, string>; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.fields = extra.fields;
    this.details = extra.details;
  }

  get status(): (typeof ERROR_STATUS)[ErrorCode] {
    return ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody['error'] = { code: this.code, message: this.message };
    if (this.fields) error.fields = this.fields;
    if (this.details) error.details = this.details;
    return { error };
  }
}

export const notFound = (message = 'Not found.') => new AppError('not_found', message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError('conflict', message, details ? { details } : {});
export const validationFailed = (message: string, fields?: Record<string, string>) =>
  new AppError('validation_failed', message, fields ? { fields } : {});
