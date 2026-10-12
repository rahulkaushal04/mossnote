import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import type { Env } from '../env';
import { createLogger } from '../logger';
import { errorHandler } from './errors';

/** What the SQLite driver throws: a named error with a code, and a message that quotes values. */
class SqliteError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SqliteError';
    this.code = code;
  }
}

function setup(thrown: () => unknown) {
  const lines: string[] = [];
  const app = new Hono<Env>();
  app.get('/boom', () => {
    throw thrown();
  });
  app.onError(errorHandler(createLogger('error', (line) => lines.push(line))));
  return { app, lines };
}

const hit = async (thrown: () => unknown) => {
  const { app, lines } = setup(thrown);
  const res = await app.request('/boom');
  return { res, body: await res.text(), lines };
};

describe('what a failed request leaves in the log', () => {
  it('names the error that caused an internal AppError, with its code', async () => {
    const cause = new SqliteError(
      'SQLITE_CONSTRAINT_PRIMARYKEY',
      'UNIQUE constraint failed: map_pins.id',
    );
    const { res, lines } = await hit(
      () => new AppError('internal', 'Import failed. Your journal is unchanged.', { cause }),
    );
    expect(res.status).toBe(500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^error request failed /);
    expect(lines[0]).toContain('code=internal');
    expect(lines[0]).toContain('kind=AppError');
    expect(lines[0]).toContain('cause=SqliteError');
    expect(lines[0]).toContain('causeCode=SQLITE_CONSTRAINT_PRIMARYKEY');
  });

  it('gives the root of a chain of causes', async () => {
    const root = new SqliteError('SQLITE_FULL', 'database or disk is full');
    const middle = new Error('wrapped', { cause: root });
    const { lines } = await hit(() => new AppError('internal', 'x', { cause: middle }));
    expect(lines[0]).toContain('cause=SqliteError');
    expect(lines[0]).toContain('causeCode=SQLITE_FULL');
  });

  it('gives the code of an error that was thrown as it is', async () => {
    const { res, lines } = await hit(
      () => new SqliteError('SQLITE_CONSTRAINT_UNIQUE', 'UNIQUE constraint failed'),
    );
    expect(res.status).toBe(500);
    expect(lines[0]).toContain('kind=SqliteError');
    expect(lines[0]).toContain('errorCode=SQLITE_CONSTRAINT_UNIQUE');
  });

  it('never writes a message, which can quote what a person wrote', async () => {
    const secret = 'my secret note about the cellar';
    const cause = new SqliteError('SQLITE_CONSTRAINT_CHECK', `CHECK constraint failed: ${secret}`);
    const outer = new AppError('internal', `Failed: ${secret}`, { cause });
    for (const thrown of [
      outer,
      cause,
      new Error(secret),
      new SyntaxError(`Unexpected "${secret}"`),
    ]) {
      const { lines } = await hit(() => thrown);
      expect(lines.join('\n')).not.toContain(secret);
    }
  });

  it('leaves out a name or code that is not plain identifier text', async () => {
    const cause = Object.assign(new Error('x'), {
      name: 'bad name\nwith a break',
      code: 'not a code!',
    });
    const { lines } = await hit(() => new AppError('internal', 'x', { cause }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('cause=');
    expect(lines[0]).not.toContain('causeCode=');
    expect(lines[0]).not.toContain('\n');
  });

  it('adds nothing when there is no cause, and does not log a cause for the person', async () => {
    const { res, body, lines } = await hit(() => new AppError('internal', 'Plain failure.'));
    expect(lines[0]).not.toContain('cause');
    expect(lines[0]).not.toContain('errorCode');
    // The response never carries the cause.
    expect(JSON.parse(body)).toEqual({ error: { code: 'internal', message: 'Plain failure.' } });
    expect(res.status).toBe(500);
  });

  it('still keeps quiet about errors that are the person’s to fix', async () => {
    const { res, lines } = await hit(
      () => new AppError('validation_failed', 'That is not valid.', { cause: new Error('x') }),
    );
    expect(res.status).toBe(400);
    expect(lines).toEqual([]);
  });

  it('carries the cause on the error for code that wants it', () => {
    const cause = new Error('inner');
    expect(new AppError('internal', 'outer', { cause }).cause).toBe(cause);
    expect(new AppError('internal', 'outer').cause).toBeUndefined();
  });
});
