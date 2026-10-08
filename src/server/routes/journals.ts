import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import {
  journalCreateSchema,
  journalDeleteSchema,
  journalPatchSchema,
} from '@shared/schemas/journal';
import { JOURNAL_PATTERN } from '@shared/journalId';
import type { JournalList } from '@shared/types';
import type { Env } from '../env';
import { AppError } from '../errors';
import { fromZod } from '../middleware/errors';
import { validateJson } from '../middleware/validate';
import type { Ctx } from '../services/ctx';
import { buildExport, buildMarkdown, exportFileName, serializeExport } from '../services/export';

const validateJournalId = zValidator(
  'param',
  z.object({ id: z.string().regex(JOURNAL_PATTERN, "That isn't a journal.") }),
  (result) => {
    if (!result.success) throw fromZod(result.error);
  },
);

const fileFor = (ctx: Ctx, id: string, extension: 'json' | 'md') =>
  exportFileName(ctx.clock.now(), extension).replace('mossnote-', `mossnote-${id}-`);

/** The journals in the data folder: list, create, switch, rename and delete. */
export const journalRoutes = (ctx: Ctx) => {
  const manager = () => {
    if (!ctx.journals) throw new AppError('not_found', 'Not found.');
    return ctx.journals;
  };
  return (
    new Hono<Env>()
      .get('/', (c): Response => {
        const journals = manager();
        const body: JournalList = { active: journals.activeId, items: journals.list() };
        return c.json(body);
      })
      .post('/', validateJson(journalCreateSchema), async (c) =>
        c.json(await manager().create(c.req.valid('json')), 201),
      )
      .post('/:id/activate', validateJournalId, async (c) =>
        c.json(await manager().activate(c.req.valid('param').id)),
      )
      .patch('/:id', validateJournalId, validateJson(journalPatchSchema), async (c) =>
        c.json(await manager().rename(c.req.valid('param').id, c.req.valid('json').name)),
      )
      // A copy of any journal, not only the open one.
      .get('/:id/export.json', validateJournalId, async (c) => {
        const { id } = c.req.valid('param');
        const body = await manager().exportFrom(id, (journal) =>
          serializeExport(buildExport(journal)),
        );
        return c.body(body, 200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileFor(ctx, id, 'json')}"`,
        });
      })
      .get('/:id/export.md', validateJournalId, async (c) => {
        const { id } = c.req.valid('param');
        const body = await manager().exportFrom(id, buildMarkdown);
        return c.body(body, 200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileFor(ctx, id, 'md')}"`,
        });
      })
      .delete('/:id', validateJournalId, validateJson(journalDeleteSchema), async (c) =>
        c.json(await manager().remove(c.req.valid('param').id, c.req.valid('json'))),
      )
  );
};
