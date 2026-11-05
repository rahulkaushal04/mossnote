# Native module strategy (better-sqlite3)

better-sqlite3 13 is built on N-API (`#include <napi.h>`) and ships per-platform prebuilds in `prebuilds/` (`gypfile: false`), loaded by `lib/binding.js`. N-API is ABI-stable across Node and Electron, so the same `darwin-arm64.node` serves vitest (Node 22) and Electron 45. No `@electron/rebuild`, no second binary, no postinstall step.

- `build.mjs` keeps `better-sqlite3` external; the main bundle `require`s it from root `node_modules`.
- Verified by the e2e `fts5Probe` (create virtual table using fts5 inside the Electron main process).
- Packaging (later phase): the `.node` must be unpacked from asar (`asarUnpack`) and the per-OS prebuild present. If a future better-sqlite3 drops N-API, fall back to `@electron/rebuild` into `dist/native`, or `node:sqlite`.
