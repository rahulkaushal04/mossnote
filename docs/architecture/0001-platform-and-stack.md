# ADR 0001: Platform and stack for the new notes app

Status: proposed (decided 2026-10-29, revisit at the triggers below)
Scope: the new offline-first notes app. The previous Mossnote code on this repo is ignored and will be replaced on branch `feat/notes-app`.

## Context (verified in this environment on 2026-10-29)

| Item | Value |
|---|---|
| Reference machine | Apple M2, 8 cores (4P+4E), 8 GB RAM, macOS 27.0.1, 59 GiB free disk |
| Node / npm | v22.22.2 / 10.9.7 (`node:sqlite` loads with FTS5, marked experimental) |
| Rust | cargo/rustc 1.98.1 |
| Apple tooling | Command Line Tools only, **no full Xcode**: `xcrun simctl` is missing, so no iOS simulator or iOS builds |
| Android | `adb` and command-line tools exist under `/opt/homebrew/share/android-commandlinetools`; SDK/emulator not checked |
| Test tooling already installed | Playwright, Vitest (from the old project's dev dependencies) |

Consequence: a desktop app is fully buildable and testable here. A native iOS app is not. A second "device" in automated sync tests must be a second app instance or headless peer on the same machine; real phone-to-desktop sync needs a human with a phone.

## Options considered

| | Electron | Tauri 2 | Native (Swift/AppKit) |
|---|---|---|---|
| Language fit | TypeScript end to end, Node 22 already present | Rust core + web UI, two languages | Swift only, macOS/iOS only |
| SQLite + FTS5 | better-sqlite3 (FTS5 to be confirmed at scaffold) or `node:sqlite` | rusqlite, or official SQL plugin (built on sqlx) | GRDB/SQLite |
| Browser engine | Bundled Chromium, consistent rendering | System webview, rendering differs per OS (reported by secondary sources) | Native |
| Footprint | Larger (secondary sources give conflicting numbers; unreliable) | Smaller (same caveat) | Smallest |
| Security model | Must configure `contextIsolation`, sandbox, no Node in renderer | Capability system by default; relies on OS for webview patches | OS sandbox |
| E2E testing on macOS | Playwright `_electron.launch()`, documented as **experimental** | `tauri-driver` does **not** support macOS directly; a WebdriverIO embedded server is the documented workaround ([docs](https://v2.tauri.app/develop/tests/webdriver/)) | XCUITest, needs full Xcode |
| Mobile path | None built in | Tauri 2 mobile + official QR plugin (`barcode-scanner`, mobile-oriented, [docs](https://v2.tauri.app/plugin/barcode-scanner/)), but iOS needs Xcode | Native iOS, needs Xcode |

Sources for the footprint and security rows are SEO/vendor blogs and disagree on numbers; treat them as direction only, not measurement. Playwright status: [docs](https://playwright.dev/docs/api/class-electron).

## Decision

**Electron + TypeScript (strict), with all domain logic outside the shell.**

Why: this environment can verify Electron end to end today (same language as the core and the MCP server, Playwright drives it, Node's `node:tls`/`node:crypto` cover the sync transport). Tauri's smaller size is attractive, but its macOS test gap and two-language split would slow the "build, run, test, fix" loop here, and the main benefit (mobile) is blocked by missing Xcode.

Keeping the shell swappable limits the risk of this choice:

```
packages/
  core/      domain model, SQLite, migrations, FTS, backup/restore, import/export, sync engine + protocol (no Electron imports)
  ui/        React + Vite renderer, talks to core only through a typed API
  desktop/   Electron main + preload: window, IPC, OS integration
  mcp/       stdio MCP server; talks to the running app over an authenticated local socket, never opens the DB directly
```

## Storage

- SQLite (WAL) is the source of truth; notes hold canonical Markdown text. Transactions, FTS5 and a durable change log for sync come with it.
- Attachments: content-addressed files on disk (SHA-256 name), referenced from the DB, verified on read and on backup.
- Portability: full export to a plain Markdown folder plus attachments; import from the same format.
- Backups: consistent snapshot via SQLite online backup, plus a verify-by-restore check.
- Rejected: files-only Markdown (no transactions, hard to sync deletes/conflicts at 100k notes); hybrid files-as-truth (two sources of truth).

## Editor

CodeMirror 6 with Markdown live-preview and a formatting toolbar, so the stored text is always plain Markdown (no lossy rich-text round trip). Decision to be validated by a small spike during the MVP, including keyboard and screen-reader behaviour.

## Sync (proposal, to be threat-modelled before implementation)

- Per-device Ed25519 identity; paired devices pinned by public-key fingerprint.
- Pairing: QR carries one-time secret (short TTL, single use), candidate IP:port list, and the host's key fingerprint; mutual TLS 1.3 with pinned keys after pairing; manual IP entry as fallback.
- Per-note records with stable IDs, hybrid logical clocks, tombstones, idempotent apply. On divergence: three-way text merge when a common base exists, otherwise keep both versions and surface a conflict. No silent overwrite.
- Not a CRDT for the MVP; revisit if merge quality is poor. Evidence for this area is thin (see `docs/research/sync-and-security.md`).

## AI and MCP

Optional and separate from the core. Local MCP server over stdio, read-only by default, scoped grants, in-app approval for writes, append-only audit log. Details follow in the spec and threat model.

## Consequences and risks

- Electron's larger footprint may miss the "warm start under 1 s" goal on an 8 GB machine; this is measured, not assumed.
- Playwright's Electron support is experimental; keep a thin fallback of core-level integration tests.
- `better-sqlite3` needs a native rebuild for Electron; `node:sqlite` is the fallback but is experimental.
- No iOS/Android app is planned until Xcode and an Android SDK/emulator are available.

## Revisit triggers

Switch the shell (core stays) if: measured warm start or idle memory misses targets with no fix, Playwright-Electron proves too flaky to gate on, or a mobile client becomes the priority and Xcode is installed.

## Spike result: editor round trip

Decision: CodeMirror 6 round-trips all 200 corpus documents (CRLF, LF, lone CR, mixed, BOM, tabs, trailing spaces, 200k-char lines, emoji/RTL, empty, fences, tables, html, frontmatter) with 0 byte differences, using a pinned line separator.

- Discrepancy: by default CodeMirror splits on `\r\n`, `\r` and `\n` and rejoins with `\n`, so CRLF and lone-CR files change on load. A test asserts this still happens without the fix.
- Strategy (`packages/ui/src/editor/createEditor.ts`): `EditorState.lineSeparator` is `\r\n` only when every break is CRLF, else `\n`. In mixed or lone-CR files the `\r` stays as a character in its line. `getText` uses `state.sliceDoc()` (not `doc.toString()`, which always uses `\n`). `setText` rebuilds the state so the separator is re-chosen. Enter inserts `state.lineBreak`, so CRLF files stay CRLF while typing.
- BOM stays in the document as U+FEFF (lossless). Whether to strip and re-add it is a T12/storage decision.
- Caveats: mixed/CR files show `\r` in lines; jsdom has no layout (Range rects are stubbed in the test) so real scrolling, IME and rendering are unverified; axe in jsdom skips color-contrast and cannot judge focus or visual issues, so Playwright axe on the real app is still needed. Keyboard: Tab/Shift-Tab indent/dedent (`indentWithTab`, which traps Tab, so a Escape-to-leave story is needed for AS-8); arrows via defaultKeymap. Tests call the commands directly rather than synthesize key events.
