import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { LIMITS } from '@shared/constants';
import type { Config } from './config';
import type { Clock, Db, Sqlite } from './db/types';
import type { Journals } from './journals/types';
import type { Env } from './env';
import type { PhoneAccess } from './phone/types';
import { silentLogger, type Logger } from './logger';
import { errorHandler, notFoundHandler } from './middleware/errors';
import { access } from './middleware/access';
import { guard } from './middleware/guard';
import { requestLog } from './middleware/request-log';
import { securityHeaders } from './middleware/security-headers';
import { AppError } from './errors';
import { dataRoutes } from './routes/data';
import { trashRoutes } from './routes/trash';
import { fieldLabelRoutes } from './routes/field-labels';
import { healthRoutes } from './routes/health';
import { mapRoutes } from './routes/maps';
import { noteRoutes } from './routes/notes';
import { pairRoutes } from './routes/pair';
import { peopleRoutes } from './routes/people';
import { phoneRoutes } from './routes/phone';
import { plantingRoutes } from './routes/plantings';
import { pickRoutes, searchRoutes } from './routes/search';
import { tagRoutes } from './routes/tags';
import { createCtx } from './services/ctx';
import type { Storage } from './services/storage';
import { settingsRoutes } from './routes/settings';
import { journalRoutes } from './routes/journals';
import { requireJournal } from './middleware/journal';

/** The slice of configuration the app needs. The app never reads the environment itself. */
export type AppConfig = Pick<
  Config,
  'port' | 'dev' | 'journal' | 'version' | 'dataDir' | 'dbPath' | 'backupsDir' | 'backupKeep'
>;

export interface AppDeps {
  /** The open journal. Omit both when the app starts without one (a first run). */
  db?: Db;
  sqlite?: Sqlite;
  /** Owns the journals. Absent in tests that use one fixed journal. */
  journals?: Journals;
  /** Where snapshots are kept; see {@link Storage}. */
  storage: Storage;
  /** Opens the data folder in the system file manager. */
  openFolder?: (dir: string) => Promise<void>;
  clock: Clock;
  config: AppConfig;
  logger?: Logger;
  /** Id generator; tests pass a deterministic one. Defaults to ULIDs. */
  ids?: () => string;
  /**
   * Lets phones and tablets on the same network use this journal. Absent in tests and in the
   * browser, where there is no network side to defend or to open.
   */
  phone?: PhoneAccess;
  /** Serves the built web app (`middleware/static.ts`). Omit in tests, in development and in the browser. */
  web?: MiddlewareHandler<Env>;
  /**
   * True when the app runs inside the browser and only its own page can send it requests. There
   * is no network to defend against, so the Host, Origin and header checks and the security
   * headers are left out.
   */
  embedded?: boolean;
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
  deps.journals?.bind(ctx);
  const api = new Hono<Env>()
    .route('/health', healthRoutes(ctx))
    .route('/journals', journalRoutes(ctx))
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
    .route('/trash', trashRoutes(ctx))
    .route('/phone', phoneRoutes(deps.phone, deps.config.port));

  const passThrough: MiddlewareHandler<Env> = (_c, next) => next();
  const { phone } = deps;
  const app = new Hono<Env>()
    .use('*', requestLog(logger))
    .use('*', deps.embedded ? passThrough : securityHeaders({ dev: deps.config.dev }))
    .use(
      '*',
      deps.embedded
        ? passThrough
        : guard({
            port: deps.config.port,
            dev: deps.config.dev,
            ...(phone ? { extraHosts: () => phone.allowedHosts() } : {}),
          }),
    )
    .use('*', phone ? access(phone) : passThrough)
    // Request bodies are limited to 1 MB, except the import upload (50 MB).
    .use('/api/*', (c, next) => {
      const handler = new URL(c.req.url).pathname === IMPORT_PATH ? importLimit : smallLimit;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- Hono types the path-scoped context's input as any
      return handler(c, next);
    })
    // Everything except health and the journal list needs an open journal, and a window that is
    // still showing another one is told so instead of writing into the wrong journal.
    .use('/api/*', requireJournal(ctx))
    .route('/api', api);
  if (phone) app.route('/pair', pairRoutes(phone));

  if (deps.web) app.use('*', deps.web);

  app.onError(errorHandler(logger));
  app.notFound(notFoundHandler);
  return app;
}

export type App = ReturnType<typeof createApp>;
/** Route types for the web client's RPC calls. */
export type AppType = App;
