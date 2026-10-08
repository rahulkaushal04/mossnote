declare module 'virtual:moss-migrations' {
  import type { Migration } from '@server/db/migrations';

  /** The `drizzle` folder's migrations, read when the app is built. */
  const migrations: Migration[];
  export default migrations;
}
