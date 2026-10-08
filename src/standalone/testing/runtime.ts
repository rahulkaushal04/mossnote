import { MIGRATIONS_FOLDER, fakeClock, type FakeClock } from '@server/testing/helpers';
import { loadMigrations } from '@server/db/migrate';
import type { ApiErrorBody } from '@shared/errors';
import { expect } from 'vitest';
import type { FilePool } from '../pool/types';
import { createRuntime, type Runtime } from '../runtime';
import { memoryPoolForTests } from './sqlite';

export interface TestRuntime {
  runtime: Runtime;
  pool: FilePool;
  clock: FakeClock;
  call(method: string, path: string, body?: unknown): Promise<Response>;
  json<T>(response: Response, status?: number): Promise<T>;
  error(response: Response, status: number): Promise<ApiErrorBody['error']>;
  /** Stop the runtime and start another on the same files, as a page reload would. */
  restart(): Promise<TestRuntime>;
}

/** The browser runtime on in-memory files, with the real migrations and a fake clock. */
export async function makeTestRuntime(existing?: {
  pool: FilePool;
  clock: FakeClock;
}): Promise<TestRuntime> {
  const pool = existing?.pool ?? (await memoryPoolForTests());
  const clock = existing?.clock ?? fakeClock();
  const runtime = await createRuntime({
    pool,
    clock,
    migrations: loadMigrations(MIGRATIONS_FOLDER),
    version: '0.0.0-test',
  });
  const self: TestRuntime = {
    runtime,
    pool,
    clock,
    call(method, path, body) {
      const mutating = method !== 'GET' && method !== 'HEAD';
      return Promise.resolve(
        runtime.app.request(path, {
          method,
          ...(mutating ? { headers: { 'content-type': 'application/json' } } : {}),
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
      );
    },
    async json(response, status = 200) {
      expect(response.status, await response.clone().text()).toBe(status);
      return (await response.json()) as never;
    },
    async error(response, status) {
      expect(response.status, await response.clone().text()).toBe(status);
      return ((await response.json()) as ApiErrorBody).error;
    },
    async restart() {
      runtime.close();
      return makeTestRuntime({ pool, clock });
    },
  };
  return self;
}
