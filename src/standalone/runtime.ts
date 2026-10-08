import { createApp, type App, type AppConfig } from '@server/app';
import { journalOfSnapshotName } from '@server/db/snapshots';
import type { Migration } from '@server/db/migrations';
import type { Clock } from '@server/db/types';
import { silentLogger } from '@server/logger';
import { openCatalog } from './catalog';
import { BrowserJournals } from './journals';
import { CATALOG_FILE } from './names';
import type { FilePool } from './pool/types';
import { createBrowserSnapshotStore } from './snapshots';
import { createBrowserStorage } from './storage';

/** Automatic snapshots kept per journal, as on the computer (`MOSS_BACKUP_KEEP`). */
const BACKUPS_KEPT = 14;

export interface RuntimeOptions {
  pool: FilePool;
  migrations: readonly Migration[];
  clock: Clock;
  version: string;
}

export interface Runtime {
  /** The whole API, answering requests that never leave the page. */
  app: App;
  journals: BrowserJournals;
  /** Close the open journal and the catalog. */
  close(): void;
}

/**
 * The Mossnote server, running inside the browser: the same app, services and SQL as the Node
 * server, over SQLite in WebAssembly and the pool's files instead of a data folder. There is no
 * network here, so there is no Host check, no phone access and no static file serving.
 */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { pool, migrations, clock, version } = options;
  const catalog = await openCatalog(pool, CATALOG_FILE, journalOfSnapshotName);
  const snapshots = createBrowserSnapshotStore(pool, catalog);
  const config: AppConfig = {
    port: 0,
    dev: false,
    journal: '',
    version,
    dataDir: '',
    dbPath: '',
    backupsDir: '',
    backupKeep: BACKUPS_KEPT,
  };

  const storage = createBrowserStorage({ snapshots, open: () => journals.open });
  const journals = new BrowserJournals({
    pool,
    catalog,
    snapshots,
    storage: () => storage,
    migrations,
    clock,
    config,
  });
  await journals.start();

  const app = createApp({
    journals,
    storage,
    clock,
    config,
    logger: silentLogger,
    embedded: true,
  });
  return {
    app,
    journals,
    close() {
      journals.close();
      catalog.close();
    },
  };
}
