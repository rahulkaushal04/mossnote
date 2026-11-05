# Native module strategy (better-sqlite3)

better-sqlite3 13 is built on N-API (`#include <napi.h>`) and ships per-platform prebuilds in `prebuilds/` (`gypfile: false`), loaded by `lib/binding.js`. N-API is ABI-stable across Node and Electron, so the same `darwin-arm64.node` serves vitest (Node 22) and Electron 45. No `@electron/rebuild`, no second binary, no postinstall step.

- `build.mjs` keeps `better-sqlite3` external; the main bundle `require`s it from root `node_modules`.
- Verified by the e2e `fts5Probe` (create virtual table using fts5 inside the Electron main process).
- Packaging (later phase): the `.node` must be unpacked from asar (`asarUnpack`) and the per-OS prebuild present. If a future better-sqlite3 drops N-API, fall back to `@electron/rebuild` into `dist/native`, or `node:sqlite`.

## Packaging notes (attachments + portability)

- `pdfjs-dist` (exact-pinned) is ESM with its own worker module and is external in both `dist/main.cjs` and `dist/pdfChild.cjs`. It must ship in `node_modules` and be listed in `asarUnpack` (the utility process and its `import()` need real files: cmaps, standard fonts, worker).
- `dist/pdfChild.cjs` is the PDF utility-process entry. It is forked from `dist/main.cjs` as `path.join(__dirname, 'pdfChild.cjs')`, so it must sit next to `main.cjs` and, like any forked entry, outside the asar (`asarUnpack: dist/pdfChild.cjs`, or fork the unpacked path). `build.mjs` fails if the child bundle contains anything except `pdfChild.ts` and core's pure `attachments/pdf` extractor (no sqlite).
- `better-sqlite3`: unpack the native `.node` prebuild (see above); it is used by main only. The restore swap (`applyPendingRestore`) also runs in main before the workspace opens.
- Quit with a running backup or import: `lifecycle` waits up to 5 s for `dispatcher.drain()`; after that the workspace closes and the process exits. Backups publish by rename, restore only stages (the swap happens at the next start under `workspace.lock`, journaled), imports commit per batch and resume; leftovers are swept by core at start.
