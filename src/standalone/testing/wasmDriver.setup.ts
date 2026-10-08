import { vi } from 'vitest';
import type * as Helpers from '@server/testing/helpers';
import { wasmMemoryDatabase } from './memoryDatabase';

/**
 * Setup for `npm run test:wasm`: the server's own tests, with every in-memory test database
 * replaced by one on SQLite in WebAssembly. Anything that differs between the two SQLite builds
 * or between the two connection adapters shows up as a failing server test.
 */
vi.mock('@server/testing/helpers', async (importOriginal) => {
  const original = await importOriginal<typeof Helpers>();
  return {
    ...original,
    migratedMemoryDatabase: () =>
      wasmMemoryDatabase({
        migrationsFolder: original.MIGRATIONS_FOLDER,
        clock: original.fakeClock(),
      }),
  };
});
