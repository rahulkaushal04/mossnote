import { defineConfig } from 'vitest/config';
import base from './vitest.config';

/**
 * The server's tests, run against SQLite in WebAssembly instead of `better-sqlite3`. Tests that
 * open journal files keep using the native driver; everything built on the in-memory test
 * database (the routes and services) exercises the browser's adapter.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/server/**/*.test.ts'],
    setupFiles: ['src/standalone/testing/wasmDriver.setup.ts'],
  },
});
