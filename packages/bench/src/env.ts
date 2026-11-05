import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import Database from 'better-sqlite3';

export interface Env {
  cpu: string;
  cores: number;
  memoryGB: number;
  os: string;
  node: string;
  sqlite: string;
  electron: string | null;
  commit: string | null;
}

const sh = (cmd: string, args: string[]): string | null => {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
};

export function detectEnv(): Env {
  const db = new Database(':memory:');
  const sqlite = (db.prepare('select sqlite_version() as v').get() as { v: string }).v;
  db.close();
  const mac = platform() === 'darwin' ? sh('sw_vers', ['-productVersion']) : null;
  const dirty = sh('git', ['status', '--porcelain']);
  const head = sh('git', ['rev-parse', '--short', 'HEAD']);
  return {
    cpu: cpus()[0]?.model ?? 'unknown',
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: mac ? `macOS ${mac} (Darwin ${release()})` : `${platform()} ${release()}`,
    node: process.version,
    sqlite,
    electron: null, // not launched by this harness
    commit: head ? (dirty ? `${head}+dirty` : head) : null,
  };
}
