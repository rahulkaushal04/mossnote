# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Refactor, no behaviour change: the map service is split into `services/maps/` (rows, maps, pins, versions, projects, queries); the map engine's `shapes` and `doc` into folders; `Canvas`, `MapEditor` and `Inspector` into `canvas/`, `editor/` and `inspector/` modules with one function per gesture; every map module has a header, and thresholds are named constants.

### Added

- Map editor rebuilt as a lightweight drawing tool: layers; paths, boxes, circles, areas, connectors, text, cards, callouts and sticky notes; smart drawing that recognises and tidies rough shapes; snapping to ends, edges, alignment, angles and the grid; rulers, guides, grid, minimap, compass and a measure tool; select, move, resize, rotate, group, align, distribute, copy, paste and duplicate with a quick bar and a right-click menu; markers with types, icons, status, tags, fields and links; exploring mode; autosave in one request; automatic and named versions with restore; map duplication; export as PNG, SVG, PDF and an editable project file (`.mossmap.json`).
- Marker types (a setting), map project files, `POST /api/maps/:id/changes`, versions and duplicate endpoints; migration `0003_map_objects` adds marker properties and `map_versions`.
- Maps: sketch with freehand drawing, pins, labels, areas and arrows in six colours, pan and zoom, undo and redo; pins link to a note, person or farm entry, which list them under "On maps"; a Places list; maps appear in search, Recently deleted, export and import.
- Game templates: a Default and a Stardew Valley template (wording and structure only), a `layout` setting, section rename, hide and reorder, composer quick actions, and one-click suggested tags, all in Settings → Game and sections.
- Foundations: one npm package with `shared`, `server` and `web` source roots and ESLint import boundaries.
- Hono server on loopback with a Host, Origin and header guard, security headers and a per-response style nonce, health and settings routes, and the unified JSON error shape.
- SQLite schema with Drizzle migrations and a hand-written full-text search migration; WAL mode, foreign keys, PID lock file, integrity check, and snapshots with retention.
- Game date helpers (`encode`, `decode`, `isValid`, `advance`, `format`, `parse`) and an editable calendar, with conflict checks when it changes.
- Web app shell with a theme (light, dark, system), bundled fonts, routes, empty states, toasts and dialogs.
- Tests: unit, integration, component, and Playwright end-to-end with axe scans, a no-network check and a run under the full CSP. CI on Node 22 and 24, plus a WebKit smoke test on macOS.
- Capture and review: notes API (idempotent create, soft delete and restore, conflict detection), composer with drafts that survive a refresh and outages, Today, Day and Journal views with URL filters and keyset pagination, inline editing with autosave, delete with undo.
- Structure: discoveries and questions, people and farm entries, `@`, `[[`, `#` and `/` pickers, backlinks, tag manager (rename, pin, merge, delete), field-label suggestions.
- Search: full-text search (SQLite FTS5) with typo tolerance, search parser (`#tag`, `@person`, quoted phrases), command palette, search results page, keyboard shortcuts and a shortcuts dialog.
- Safety: JSON and Markdown export, validated import in one transaction with a pre-import snapshot, manual and automatic snapshots, Recently deleted with a 30-day purge, complete Settings.
- Playwright end-to-end specs for capture and notes, with the shared fixture that resets the journal between tests.

### Fixed

- Undoing a map drawing now restores the earlier drawing (it used to record the new one).
- The Data settings list put a button inside a definition list, an accessibility error; the "No date" control on undated notes had an invalid ARIA attribute.
- `npm run check:network` failed on a message string inside the bundled validation library; that host is now on the built-output allow list (it is never fetched).
- Delete, restore and other bodiless requests were refused by the guard because the client omitted `Content-Type`.
- A draft could be lost during an outage; it is now kept until the server confirms the save.
- Snapshot numbering could reuse a sequence and make an import fail with a 500.
- "Set date" in the note menu opened a picker that the closing menu immediately dismissed.
- Typing a day number in the date picker was ignored while a season option had focus.
- Lists of people and farm entries were capped at 100 items; the limit is now 500.
