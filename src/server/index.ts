import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import open from 'open';
import { createApp } from './app';
import { describeStartupError } from './boot';
import { loadConfig, type Config } from './config';
import { JournalManager } from './journals/manager';
import { createLogger } from './logger';

const systemClock = { now: () => Date.now() };
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

  const webRoot = config.dev ? undefined : fileURLToPath(new URL('../web', import.meta.url));
  const app = createApp({
    journals,
    openFolder: async (dir) => {
      await open(dir);
    },
    clock: systemClock,
    config,
    logger,
    ...(webRoot ? { webRoot } : {}),
  });

  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    logger.info(`Mossnote is running at ${url}`);
    logger.info(`Data folder: ${config.dataDir}`);
    logger.info(
      journals.activeId ? `Journal: ${journals.activeId}` : 'No journal yet. Make one in the app.',
    );
    if (config.allowRemote) {
      logger.warn('MOSS_ALLOW_REMOTE is set. Remote access is unsupported and unauthenticated.');
    }
    if (config.openBrowser) {
      open(url).catch(() => {
        logger.info(`Open ${url} in your browser.`);
      });
    }
  });

  server.on('error', (error) => {
    writeError(describeStartupError(error, config));
    journals.close();
    process.exit(1);
  });

  const shutdown = () => {
    server.close();
    journals.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
