import { createApp, type AppConfig } from '../app';
import type { Database } from '../db/client';
import { ensureSettings } from '../services/settings';
import path from 'node:path';
import {
  fakeClock,
  makeTempDir,
  migratedMemoryDatabase,
  removeDir,
  type FakeClock,
} from './helpers';

export const TEST_PORT = 4317;
export const TEST_HOST = `127.0.0.1:${TEST_PORT}`;

export const testConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  port: TEST_PORT,
  dev: false,
  journal: 'journal',
  version: '0.1.0-test',
  dataDir: '/tmp/moss-test-unused',
  dbPath: '/tmp/moss-test-unused/journal.db',
  backupsDir: '/tmp/moss-test-unused/backups',
  backupKeep: 14,
  ...overrides,
});

export interface TestApp {
  app: ReturnType<typeof createApp>;
  database: Database;
  clock: FakeClock;
  /** The temporary data folder of this app. */
  dir: string;
  /** Request as the web client would: loopback Host, JSON content type and the client header. */
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
  /** Request with exactly the headers given (no defaults). */
  raw(
    method: string,
    path: string,
    init?: { headers?: Record<string, string>; body?: string },
  ): Promise<Response>;
  close(): void;
}

export async function makeTestApp(
  options: { config?: Partial<AppConfig>; webRoot?: string } = {},
): Promise<TestApp> {
  const database = await migratedMemoryDatabase();
  const clock = fakeClock();
  // A real folder per app, so snapshots and exports have somewhere to go.
  const dir = makeTempDir('moss-app-');
  ensureSettings(database, 'journal', clock);
  const app = createApp({
    db: database.db,
    sqlite: database.sqlite,
    clock,
    config: testConfig({
      dataDir: dir,
      dbPath: path.join(dir, 'journal.db'),
      backupsDir: path.join(dir, 'backups'),
      ...options.config,
    }),
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
  });
  return {
    app,
    database,
    clock,
    dir,
    call(method, path, body, headers = {}) {
      const mutating = method !== 'GET' && method !== 'HEAD';
      return Promise.resolve(
        app.request(path, {
          method,
          headers: {
            host: TEST_HOST,
            ...(mutating ? { 'content-type': 'application/json', 'x-moss-client': 'web' } : {}),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    },
    raw(method, path, init = {}) {
      return Promise.resolve(
        app.request(path, {
          method,
          headers: init.headers ?? {},
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
      );
    },
    close() {
      database.sqlite.close();
      removeDir(dir);
    },
  };
}
