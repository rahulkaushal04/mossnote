import fs from 'node:fs';
import type { Config } from './config';

/**
 * Create the data folder (mode 0700) and its backups folder. Nothing is ever written outside it.
 * An existing folder keeps whatever permissions the user gave it.
 */
export function ensureDataDir(config: Pick<Config, 'dataDir' | 'backupsDir'>): void {
  for (const dir of [config.dataDir, config.backupsDir]) {
    if (fs.existsSync(dir)) continue;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(dir, 0o700);
    } catch {
      // Platforms without POSIX modes.
    }
  }
}
