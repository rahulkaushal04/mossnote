import path from 'node:path';
import os from 'node:os';
import envPaths from 'env-paths';
import { DEFAULT_PORT } from '@shared/constants';

/** Raised for any bad configuration. The message is printed to the terminal as is. */
export class ConfigError extends Error {}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  journal: string;
  dbPath: string;
  lockPath: string;
  backupsDir: string;
  backupKeep: number;
  openBrowser: boolean;
  logLevel: LogLevel;
  allowRemote: boolean;
  /** True under `npm run dev`: the guard also accepts the Vite dev server origin. */
  dev: boolean;
  version: string;
}

const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];
const JOURNAL_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

export function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);
}

function parseInteger(name: string, raw: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} must be a whole number, got "${raw}".`);
  const value = Number(raw);
  if (value < min || value > max) {
    throw new ConfigError(`${name} must be between ${min} and ${max}, got ${value}.`);
  }
  return value;
}

function defaultDataDir(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'win32') {
    // %APPDATA%\Mossnote\ (env-paths would pick the local, non-roaming folder).
    return path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Mossnote');
  }
  // macOS "Mossnote", Linux "mossnote".
  const name = process.platform === 'linux' ? 'mossnote' : 'Mossnote';
  return envPaths(name, { suffix: '' }).data;
}

/**
 * Read once at startup. The only place in the server that reads the environment
 * (the `env` argument defaults to `process.env`).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const allowRemote = env.MOSS_ALLOW_REMOTE === '1';
  const host = env.MOSS_HOST ?? '127.0.0.1';
  if (!isLoopbackHost(host) && !allowRemote) {
    throw new ConfigError(
      `MOSS_HOST is "${host}", which is not a loopback address. Mossnote only listens on ` +
        'loopback (127.0.0.1, ::1 or localhost). Remote access is unsupported; setting ' +
        'MOSS_ALLOW_REMOTE=1 overrides this at your own risk.',
    );
  }

  const port = parseInteger('MOSS_PORT', env.MOSS_PORT ?? String(DEFAULT_PORT), 1, 65_535);

  const journal = env.MOSS_JOURNAL ?? 'journal';
  if (!JOURNAL_PATTERN.test(journal)) {
    throw new ConfigError(
      `MOSS_JOURNAL must be 1 to 40 letters, digits, "-" or "_", got "${journal}".`,
    );
  }

  const backupKeep = parseInteger('MOSS_BACKUP_KEEP', env.MOSS_BACKUP_KEEP ?? '14', 1, 1_000);

  const openRaw = env.MOSS_OPEN_BROWSER ?? '1';
  if (openRaw !== '0' && openRaw !== '1') {
    throw new ConfigError(`MOSS_OPEN_BROWSER must be 0 or 1, got "${openRaw}".`);
  }

  const logLevel = (env.MOSS_LOG_LEVEL ?? 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`MOSS_LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}.`);
  }

  const dataDir = path.resolve(env.MOSS_DATA_DIR ?? defaultDataDir(env));

  return {
    host,
    port,
    dataDir,
    journal,
    dbPath: path.join(dataDir, `${journal}.db`),
    lockPath: path.join(dataDir, `${journal}.lock`),
    backupsDir: path.join(dataDir, 'backups'),
    backupKeep,
    openBrowser: openRaw === '1',
    logLevel,
    allowRemote,
    dev: env.NODE_ENV === 'development',
    version: env.npm_package_version ?? '0.1.0',
  };
}
