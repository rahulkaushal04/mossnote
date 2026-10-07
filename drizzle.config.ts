import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
  // Drizzle Studio opens the development database only, never the real journal.
  dbCredentials: { url: './.dev-data/journal.db' },
});
