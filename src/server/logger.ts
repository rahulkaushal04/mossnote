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
 * `fields`: logs never contain note, person or farm text (spec section 20).
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

export const silentLogger: Logger = createLogger('error', () => undefined);
