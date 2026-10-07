import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import open from 'open';
import { createApp } from './app';
import { describeStartupError, openJournal, type Journal } from './boot';
import { loadConfig, type Config } from './config';
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
  let journal: Journal;
  try {
    journal = await openJournal({
      config,
      clock: systemClock,
      logger,
      // dist/server/index.js and src/server/index.ts both sit two levels below the repository root.
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  } catch (error) {
    writeError(describeStartupError(error, config));
    process.exit(1);
  }

  const webRoot = config.dev ? undefined : fileURLToPath(new URL('../web', import.meta.url));
  const app = createApp({
    db: journal.database.db,
    sqlite: journal.database.sqlite,
    clock: systemClock,
    config,
    logger,
    ...(webRoot ? { webRoot } : {}),
  });

  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => {
    logger.info(`Mossnote is running at ${url}`);
    logger.info(`Journal: ${config.dbPath}`);
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
    journal.close();
    process.exit(1);
  });

  const shutdown = () => {
    server.close();
    journal.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
