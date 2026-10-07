/**
 * Arguments `npm run dev` gives tsx to run the API. `--tsconfig` points tsx at the server project
 * because the root tsconfig.json only holds project references, so it has no path aliases.
 */
export const API_ARGS = ['watch', '--tsconfig', 'tsconfig.server.json', 'src/server/index.ts'];
