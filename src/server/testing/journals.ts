import path from 'node:path';
import { createApp } from '../app';
import { loadConfig, type Config } from '../config';
import { JournalManager } from '../journals/manager';
import { silentLogger } from '../logger';
import { TEST_HOST } from './app';
import { fakeClock, makeTempDir, MIGRATIONS_FOLDER, removeDir, type FakeClock } from './helpers';

export interface JournalsApp {
  app: ReturnType<typeof createApp>;
  manager: JournalManager;
  config: Config;
  clock: FakeClock;
  /** The data folder, with the journals side by side in it. */
  dir: string;
  /** Opened folders, in order, instead of a file manager window. */
  opened: string[];
  call(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response>;
  /** Stop the app: closes the open journal and removes the folder. */
  close(): void;
  /** Close the open journal but keep the folder, to start again on the same data. */
  stop(): void;
}

/**
 * The real app on a real data folder, with the journal manager in charge of which journal is
 * open. `prepare` can put files in the folder before the manager starts (an older version's
 * journal, for instance).
 */
export async function makeJournalsApp(
  options: {
    env?: Record<string, string>;
    prepare?: (dir: string) => void | Promise<void>;
    dir?: string;
    migrationsFolder?: string;
    start?: boolean;
  } = {},
): Promise<JournalsApp> {
  const dir = options.dir ?? makeTempDir('moss-journals-');
  await options.prepare?.(dir);
  const config = loadConfig({ MOSS_DATA_DIR: path.join(dir, 'data'), ...options.env });
  const clock = fakeClock();
  const manager = new JournalManager({
    config,
    clock,
    logger: silentLogger,
    migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER,
  });
  if (options.start !== false) await manager.start();
  const opened: string[] = [];
  const app = createApp({
    journals: manager,
    openFolder: (folder) => {
      opened.push(folder);
      return Promise.resolve();
    },
    clock,
    config: { ...config, port: 4317, version: '0.1.0-test' },
  });
  return {
    app,
    manager,
    config,
    clock,
    dir,
    opened,
    call(method, route, body, headers = {}) {
      const mutating = method !== 'GET' && method !== 'HEAD';
      return Promise.resolve(
        app.request(route, {
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
    close() {
      manager.close();
      removeDir(dir);
    },
    stop() {
      manager.close();
    },
  };
}
