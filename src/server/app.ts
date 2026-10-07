import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS } from '@shared/constants';
import type { Config } from './config';
import type { Db, Sqlite } from './db/client';
import type { Clock } from './db/backup';
import type { Env } from './env';
import { silentLogger, type Logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { guard } from './middleware/guard';
import { requestLog } from './middleware/request-log';
import { securityHeaders } from './middleware/security-headers';
import { serveWeb } from './middleware/static';
import { AppError } from './errors';
import { dataRoutes } from './routes/data';
import { trashRoutes } from './routes/trash';
import { fieldLabelRoutes } from './routes/field-labels';
import { healthRoutes } from './routes/health';
import { mapRoutes } from './routes/maps';
import { noteRoutes } from './routes/notes';
import { peopleRoutes } from './routes/people';
import { plantingRoutes } from './routes/plantings';
import { pickRoutes, searchRoutes } from './routes/search';
import { tagRoutes } from './routes/tags';
import { createCtx } from './services/ctx';
import { settingsRoutes } from './routes/settings';

/** The slice of configuration the app needs. The app never reads the environment itself. */
export type AppConfig = Pick<
  Config,
  'port' | 'dev' | 'journal' | 'version' | 'dataDir' | 'dbPath' | 'backupsDir' | 'backupKeep'
>;

export interface AppDeps {
  db: Db;
  sqlite: Sqlite;
  clock: Clock;
  config: AppConfig;
  logger?: Logger;
  /** Id generator; tests pass a deterministic one. Defaults to ULIDs. */
  ids?: () => string;
  /** Built web app to serve (`dist/web`). Omit in tests and in development. */
  webRoot?: string;
}

const IMPORT_PATH = '/api/data/import';

/** Build the Hono app. It never listens: `index.ts` does that, and tests call `app.request()`. */
export function createApp(deps: AppDeps) {
  const logger = deps.logger ?? silentLogger;

  const tooLarge = () => new AppError('too_large', 'That request is too large.');
  const limit = (maxSize: number) =>
    bodyLimit({
      maxSize,
      onError: () => {
        throw tooLarge();
      },
    });
  const smallLimit = limit(LIMITS.requestBodyBytes) as MiddlewareHandler<Env>;
  const importLimit = limit(LIMITS.importBodyBytes) as MiddlewareHandler<Env>;
  const ctx = createCtx(deps);
  const api = new Hono<Env>()
    .route('/health', healthRoutes(ctx))
    .route('/settings', settingsRoutes(ctx))
    .route('/notes', noteRoutes(ctx))
    .route('/people', peopleRoutes(ctx))
    .route('/plantings', plantingRoutes(ctx))
    .route('/maps', mapRoutes(ctx))
    .route('/tags', tagRoutes(ctx))
    .route('/field-labels', fieldLabelRoutes(ctx))
    .route('/search', searchRoutes(ctx))
    .route('/pick', pickRoutes(ctx))
    .route('/data', dataRoutes(ctx))
    .route('/trash', trashRoutes(ctx));

  const app = new Hono<Env>()
    .use('*', requestLog(logger))
    .use('*', securityHeaders({ dev: deps.config.dev }))
    .use('*', guard({ port: deps.config.port, dev: deps.config.dev }))
    // Request bodies are limited to 1 MB, except the import upload (50 MB).
    .use('/api/*', (c, next) => {
      const handler = new URL(c.req.url).pathname === IMPORT_PATH ? importLimit : smallLimit;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Hono types the path-scoped context's input as any
      return handler(c, next);
    })
    .route('/api', api);

  if (deps.webRoot) app.use('*', serveWeb(deps.webRoot));

  app.onError(errorHandler(logger));
  app.notFound(notFoundHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
/** Route types for the web client's RPC calls. */
export type AppType = App;
