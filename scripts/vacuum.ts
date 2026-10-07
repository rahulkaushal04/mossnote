import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '../src/server/config';
import { openDatabase } from '../src/server/db/client';
import { acquireLock, AlreadyRunningError } from '../src/server/lock';

/**
 * `npm run db:vacuum`: maintenance vacuum (spec section 18; there is no automatic vacuum).
 * Takes the journal's lock first, so it refuses to run while the app is running.
 */
export function vacuumJournal(
  config: Pick<Config, 'dbPath' | 'lockPath'>,
  /** Process id written to the lock; tests pass another one to stand in for a second process. */
  pid?: number,
): { before: number; after: number } {
  const lock = acquireLock(config.lockPath, pid);
  try {
    const { sqlite } = openDatabase(config.dbPath);
    const size = () =>
      (sqlite.pragma('page_count', { simple: true }) as number) *
      (sqlite.pragma('page_size', { simple: true }) as number);
    const before = size();
    sqlite.exec('VACUUM');
    const after = size();
    sqlite.close();
    return { before, after };
  } finally {
    lock.release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  try {
    const { before, after } = vacuumJournal(config);
    process.stdout.write(
      `Vacuumed ${config.dbPath}: ${before} bytes before, ${after} bytes after.\n`,
    );
  } catch (error) {
    if (error instanceof AlreadyRunningError) {
      process.stderr.write('Mossnote is running. Stop it before running a vacuum.\n');
    } else {
      process.stderr.write(`${(error as Error).message}\n`);
    }
    process.exit(1);
  }
}
