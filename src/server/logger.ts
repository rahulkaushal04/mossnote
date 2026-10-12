import type { LogLevel } from './config';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(message: string, fields?: Record<string, string | number>): void;
  warn(message: string, fields?: Record<string, string | number>): void;
  info(message: string, fields?: Record<string, string | number>): void;
  debug(message: string, fields?: Record<string, string | number>): void;
}

/**
 * One line per event on stdout. Only metadata (route, status, duration, request id) belongs in
 * `fields`: logs never contain note, person or farm text.
 */
export function createLogger(
  level: LogLevel,
  write: (line: string) => void = (line) => {
    process.stdout.write(`${line}\n`);
  },
): Logger {
  const emit =
    (at: LogLevel) =>
    (message: string, fields: Record<string, string | number> = {}) => {
      if (ORDER[at] > ORDER[level]) return;
      const rest = Object.entries(fields)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      write(`${at} ${message}${rest ? ` ${rest}` : ''}`);
    };
  return { error: emit('error'), warn: emit('warn'), info: emit('info'), debug: emit('debug') };
}

// A name or code is logged only when it is plain identifier text, so nothing a person wrote, and
// nothing that could break a log line, can get in by way of an error.
const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;

/** What may be logged about an error: its name and its code (SQLITE_FULL, ENOENT), never its message. */
export function errorFacts(error: unknown): { name?: string; code?: string } {
  if (typeof error !== 'object' || error === null) return {};
  const { name, code } = error as { name?: unknown; code?: unknown };
  return {
    ...(typeof name === 'string' && NAME_PATTERN.test(name) ? { name } : {}),
    ...(typeof code === 'string' && CODE_PATTERN.test(code) ? { code } : {}),
  };
}

export const silentLogger: Logger = createLogger('error', () => undefined);
