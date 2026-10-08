/**
 * Stands in for the native `better-sqlite3` module in the standalone web app. Drizzle's driver
 * imports it to build a connection when it is given a file name; the browser always hands it a
 * connection of its own, so the import is never used. A native module cannot run in a browser,
 * and using this one fails loudly. `vite.config.ts` aliases the package to this file.
 */
export default function NoNativeSqlite(): never {
  throw new Error('The native SQLite module is not available in the browser.');
}
