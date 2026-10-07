# Changelog

All notable changes to this project are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 2026-10-07

First entry. This is where the project starts.

### Added

**Journal**

- Notes with a composer that saves on Cmd/Ctrl+Enter, keeps drafts through a refresh or an outage, and stamps each note with the current game date.
- Today, Day and Journal views with filters for discoveries, questions, tags, people, date ranges and undated notes. Notes can be edited in place, and a delete can be undone.
- Discoveries and questions. A question can be left open, marked solved or ignored, and given an answer.
- People and farm entries, each page built from the notes that mention it. `@person`, `[[farm entry]]`, `#tag` and `/` pickers create records as you type.
- A tag manager (rename, pin, merge, delete) and suggestions for field labels.
- An editable game calendar, with checks when a change would affect existing dates.

**Maps**

- A map editor built on SVG: freehand paths, boxes, circles, areas, connectors, text, cards, callouts, sticky notes and markers, on named layers.
- Smart drawing that turns rough strokes into clean shapes, with an offer to keep the original.
- Snapping to points, edges, alignment lines, angles and the grid, which Alt pauses. Guides, grid, rulers, minimap, compass and a measure tool.
- Select, move, resize, rotate, group, lock, hide, rename, align, distribute, copy, paste and duplicate, with a quick bar, a right-click menu and keyboard shortcuts.
- Markers with an icon, status, tags and fields, and a link to a note, a person or a farm entry. The linked page lists them under "On maps". Marker types are your own to define.
- Exploring mode, for switching between the game and the map.
- Autosave in a single request, undo and redo, and version history with automatic and named versions.
- Duplicate a map. Export to PNG, SVG, PDF or an editable project file (`.mossmap.json`) that can be opened again.
- A Places list across all maps.

**Game templates**

- A default template and one for Stardew Valley. A template holds wording and structure only, never game information.
- Rename, hide and reorder sections, quick actions above the note box, and one-click suggested tags, all under Settings.

**Search**

- Full-text search on SQLite FTS5 with typo tolerance, `#tag`, `@person` and quoted phrases, a command palette on Cmd/Ctrl+K, a results page, and a shortcuts dialog. Maps and markers match by plain text.

**Safety**

- JSON and Markdown export. Import that validates the file, runs in one transaction and takes a snapshot first.
- Automatic and manual snapshots, an integrity check on every start, and Recently deleted with a 30-day purge.
- Settings for theme, reading size, calendar, game, sections and data.

**Under the hood**

- One npm package with `shared`, `server` and `web` source folders, and ESLint rules that enforce who may import whom.
- A Hono server on loopback only, with Host and Origin checks, a required header on writes, strict security headers and a per-response style nonce, and one JSON error shape.
- SQLite with Drizzle migrations, a hand-written full-text search migration, WAL mode, foreign keys, a PID lock file and snapshot retention.
- A web app shell with light, dark and system themes, bundled fonts, empty states, toasts and dialogs.
- No outgoing network connections. A check fails the build if the source or the output contains a non-local URL.
- Tests: unit, integration and component tests, and Playwright end-to-end tests with axe accessibility scans in both themes and a run under the full Content-Security-Policy.
- GitHub Actions on Node 22 and 24, a WebKit smoke test on macOS, Dependabot, issue forms and a pull request template.
- README, CONTRIBUTING, SECURITY and a Code of Conduct.
