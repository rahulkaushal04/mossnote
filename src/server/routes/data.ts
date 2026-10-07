import { Hono } from 'hono';
import { importQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { validationFailed } from '../errors';
import { validateQuery } from '../middleware/validate';
import { backupNow, dataInfo, listBackups } from '../services/backups';
import type { Ctx } from '../services/ctx';
import { buildExport, buildMarkdown, exportFileName, serializeExport } from '../services/export';
import { dryRunImport, importJournal } from '../services/import';

export const dataRoutes = (ctx: Ctx) =>
  new Hono<Env>()
    .get('/info', (c) => c.json(dataInfo(ctx)))
    .get('/export.json', (c) => {
      const body = serializeExport(buildExport(ctx));
      return c.body(body, 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(ctx.clock.now(), 'json')}"`,
      });
    })
    .get('/export.md', (c) =>
      c.body(buildMarkdown(ctx), 200, {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(ctx.clock.now(), 'md')}"`,
      }),
    )
    .post('/import', validateQuery(importQuerySchema), async (c) => {
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw validationFailed("That file isn't valid JSON.");
      }
      const dry = c.req.valid('query').dryRun;
      if (dry === '1' || dry === 'true') return c.json(dryRunImport(raw));
      return c.json(await importJournal(ctx, raw));
    })
    .post('/backup', async (c) => c.json(await backupNow(ctx)))
    .get('/backups', (c) => c.json({ items: listBackups(ctx) }));
