import { fileURLToPath } from 'node:url';
import open from 'open';
import { createApp } from './app';
import { describeStartupError } from './boot';
import { loadConfig, type Config } from './config';
import { JournalManager } from './journals/manager';
import { createFolderStorage } from './db/folderStorage';
import { ALL_INTERFACES, startListener, type Listener } from './listener';
import { createLogger } from './logger';
import { serveWeb } from './middleware/static';
import { createPhoneAccess, readPhonePreference } from './phone';

const systemClock = { now: () => Date.now() };

/** Time for the answer to "turn phone access on" to reach the browser before the socket moves. */
const REBIND_DELAY_MS = 200;
const writeError = (lines: string[]) => {
  for (const line of lines) process.stderr.write(`${line}\n`);
};

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (error) {
    writeError(describeStartupError(error, { host: '127.0.0.1', port: 4317 } as Config));
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  const journals = new JournalManager({
    config,
    clock: systemClock,
    logger,
    // dist/server/index.js and src/server/index.ts both sit two levels below the package root.
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  try {
    await journals.start();
  } catch (error) {
    writeError(describeStartupError(error, config));
    process.exit(1);
  }

  const phoneOn =
    config.lan === 'saved' ? (readPhonePreference(config.dataDir) ?? false) : config.lan === 'on';
  const phone = createPhoneAccess({
    dataDir: config.dataDir,
    port: config.port,
    clock: systemClock,
    enabled: phoneOn,
  });

  const webRoot = config.dev ? undefined : fileURLToPath(new URL('../web', import.meta.url));
  const app = createApp({
    journals,
    storage: createFolderStorage(config),
    phone,
    openFolder: async (dir) => {
      await open(dir);
    },
    clock: systemClock,
    config,
    logger,
    ...(webRoot ? { web: serveWeb(webRoot) } : {}),
  });

  const hostFor = (phoneAccess: boolean) => (phoneAccess ? ALL_INTERFACES : config.host);
  let listener: Listener;
  try {
    listener = await startListener({ app, host: hostFor(phoneOn), port: config.port });
  } catch (error) {
    writeError(describeStartupError(error, config));
    journals.close();
    process.exit(1);
  }

  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  logger.info(`Mossnote is running at ${url}`);
  logger.info(`Data folder: ${config.dataDir}`);
  logger.info(
    journals.activeId ? `Journal: ${journals.activeId}` : 'No journal yet. Make one in the app.',
  );
  if (config.allowRemote) {
    logger.warn('MOSS_ALLOW_REMOTE is set. Remote access is unsupported and unauthenticated.');
  }
  if (phoneOn) {
    logger.info('Phone access is on. Pair a phone in Settings, then Phone.');
  }
  if (config.openBrowser) {
    open(url).catch(() => {
      logger.info(`Open ${url} in your browser.`);
    });
  }

  // Switching phone access moves the socket between this computer only and every interface. The
  // short delay lets the response to the request that asked for it reach the browser first.
  phone.onChange((phoneAccess) => {
    setTimeout(() => {
      listener
        .rebind(hostFor(phoneAccess))
        .then(() => {
          logger.info(phoneAccess ? 'Phone access is on.' : 'Phone access is off.');
        })
        .catch((error: unknown) => {
          logger.error('could not change the address Mossnote listens on', {
            reason: error instanceof Error ? error.message : String(error),
          });
        });
    }, REBIND_DELAY_MS);
  });

  const shutdown = () => {
    void listener.close();
    journals.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
