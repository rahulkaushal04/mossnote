import { build } from 'esbuild';

// better-sqlite3 is N-API with per-platform prebuilds, so it stays external and loads from node_modules (see NATIVE.md).
// pdfjs-dist is ESM with its own worker module: it stays external (native import() from node_modules at run time).
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
};
await build({
  ...common,
  entryPoints: ['src/main.ts'],
  external: ['electron', 'better-sqlite3', 'pdfjs-dist'],
});
await build({ ...common, entryPoints: ['src/preload.ts'], external: ['electron'] });
// PDF text extraction utilityProcess. import.meta.url (used by core to find pdf.js cmaps and fonts) is a
// CJS __filename here, so pdfjs-dist resolves from node_modules next to the app.
const child = await build({
  ...common,
  metafile: true,
  entryPoints: ['src/pdfChild.ts'],
  external: ['pdfjs-dist'],
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
});
// The child must bundle only the pure extractor, never core's sqlite code (it would load better-sqlite3 in a utility process).
const inputs = Object.keys(child.metafile.inputs);
const stray = inputs.filter((f) => !/(^|\/)(pdfChild|pdfExtract)\.ts$/.test(f));
if (stray.length) throw new Error(`pdfChild.cjs pulled in unexpected modules: ${stray.join(', ')}`);
