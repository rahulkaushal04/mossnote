import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { fromZod } from '../middleware/errors';
import { importQuerySchema } from '@shared/schemas/misc';
import type { Env } from '../env';
import { AppError, validationFailed } from '../errors';
import { validateQuery } from '../middleware/validate';
import { backupNow, dataInfo, deleteBackup, listBackups } from '../services/backups';
import type { Ctx } from '../services/ctx';
import { buildExport, buildMarkdown, exportFileName, serializeExport } from '../services/export';
import { dryRunImport, importJournal } from '../services/import';

const validateBackupName = zValidator(
  'param',
  z.object({ name: z.string().max(200) }),
  (result) => {
    if (!result.success) throw fromZod(result.error);
  },
);

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
    .get('/backups', (c) => c.json({ items: listBackups(ctx) }))
    .post('/backups/:name/restore', validateBackupName, async (c) => {
      if (!ctx.journals) throw new AppError('not_found', 'Not found.');
      return c.json(await ctx.journals.restoreSnapshot(c.req.valid('param').name));
    })
    .delete('/backups/:name', validateBackupName, (c) => {
      deleteBackup(ctx, c.req.valid('param').name);
      return c.body(null, 204);
    })
    // Opens the data folder in the system file manager. Takes no path: it can only open this one.
    .post('/open-folder', async (c) => {
      await ctx.openFolder(ctx.config.dataDir);
      return c.body(null, 204);
    });
