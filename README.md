# Mossnote

A private journal for one player and one game, kept on your own computer.

You write down what you find out, in your own words. Mossnote only remembers it for you. It ships with no information about any game, so it can never spoil anything.

> **Status:** not released yet. The work is on a development branch. Notes, people, farm entries, maps, game templates, search, export, import, backups and Recently deleted all work. What is left before `v0.1.0` is listed in the [status table](#where-it-stands).

## What it promises

- **No spoilers.** There are no names, items, places or mechanics anywhere in the app. A new journal is empty. The only default that looks like a game is an editable calendar of four seasons with 28 days each.
- **Your data stays with you.** Everything is stored in one SQLite file on your machine.
- **No network.** The server listens on loopback only and makes no outgoing connections. There are no accounts, analytics, crash reports or update checks. Fonts and other assets are bundled.

## Quick start

You need Node 22 or newer. The `.nvmrc` file pins the version I develop on.

```bash
git clone https://github.com/rahulkaushal04/mossnote.git
cd mossnote
npm install
npm start
```

`npm start` builds the app if it has to, starts the server at `http://127.0.0.1:4317` and opens your browser.

## What you can do

**Write quickly.** The box on Today saves with Cmd/Ctrl+Enter and stays where it is. New notes get the current game date. A draft survives a refresh.

**Link as you type.** `#tag`, `@person`, `[[farm entry]]` and `/` pickers create things on the spot. Nothing exists until you make it.

**Look back.** Today, Day and Journal views, with filters for discoveries, questions, tags, people, date ranges and undated notes. Edit in place, and undo a delete.

**Keep track of questions.** Mark a note as a question, then leave it open, mark it solved or ignore it, and write your own answer.

**See people and farm entries.** Each page is built only from what you recorded, with the notes that mention it.

**Draw maps.** The map editor is a small drawing tool for the places you explore.

- Draw freehand and rough shapes are tidied up. A wobbly circle becomes a circle, and paths smooth out and snap to what is already there.
- Paths, boxes, circles, areas, connectors, text, sticky notes and markers, on layers you name.
- Snapping, guides, a grid, rulers, a minimap, copy and paste, grouping, alignment and undo.
- Markers have an icon, a status, tags and fields, and can link to a note, a person or a farm entry. That page then lists the marker under "On maps". You can define your own marker types.
- Exploring mode is for flipping between the game and the map.
- Version history, duplicate a map, and export to PNG, SVG, PDF or an editable project file.

The maps are your own drawings. Nothing about any game comes with them.

**Pick a game.** In Settings, choosing a game changes the wording (for example "NPCs" and "Daily journal") and adds a few one-tap actions above the note box. You can rename, hide and reorder sections, or turn a pinned tag into a section of your own. A template holds vocabulary only.

**Search.** Cmd/Ctrl+K opens a palette with full-text search that forgives typos. The results page understands `#tag`, `@person` and "quoted phrases". Maps and markers match on plain text.

**Stay safe.** Export as JSON or Markdown, import a file (it replaces the journal, after a snapshot is taken), automatic and manual snapshots, and 30 days of Recently deleted.

Press `?` inside the app to see the keyboard shortcuts.

## Where your data lives

Each journal is one file in a folder just for you. The folder is created with mode 0700 and the database with mode 0600.

| Platform | Default folder                                                  |
| -------- | --------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Mossnote/`                       |
| Linux    | `$XDG_DATA_HOME/mossnote/` (default `~/.local/share/mossnote/`) |
| Windows  | `%APPDATA%\Mossnote\`                                           |

```text
journal.db      your journal (and journal.db-wal and journal.db-shm while it runs)
journal.lock    stops a second server from opening the same journal
backups/        snapshots
```

### Snapshots

Snapshots use SQLite's online backup, so they are safe to take while the app is running. Copying `journal.db` by hand is not a safe backup, because the write-ahead log may hold recent changes.

| Reason          | When                                             | How many are kept                  |
| --------------- | ------------------------------------------------ | ---------------------------------- |
| `auto`          | At start, if the newest one is over 24 hours old | The newest 14 (`MOSS_BACKUP_KEEP`) |
| `pre-migration` | Before a migration runs on an existing journal   | The newest 3                       |
| `pre-import`    | Before an import replaces the journal            | The newest 5                       |
| `manual`        | When you ask for one                             | All of them                        |

Every start runs an integrity check. If it fails, the server refuses to start and tells you which snapshot is newest. To restore:

1. Stop Mossnote.
2. Copy a snapshot from `backups/` over `journal.db`.
3. Delete `journal.db-wal` and `journal.db-shm`.
4. Start Mossnote again.

## Configuration

All settings are environment variables that start with `MOSS_`. None are required. [`.env.example`](.env.example) lists them with comments.

| Variable            | Default          | What it does                                                       |
| ------------------- | ---------------- | ------------------------------------------------------------------ |
| `MOSS_HOST`         | `127.0.0.1`      | Address to listen on. Must be loopback                             |
| `MOSS_PORT`         | `4317`           | HTTP port                                                          |
| `MOSS_DATA_DIR`     | platform default | Where the data folder is                                           |
| `MOSS_JOURNAL`      | `journal`        | File name without `.db`. Use another name for a second playthrough |
| `MOSS_BACKUP_KEEP`  | `14`             | How many automatic snapshots to keep                               |
| `MOSS_OPEN_BROWSER` | `1`              | Set to `0` to stop it opening a browser                            |
| `MOSS_LOG_LEVEL`    | `info`           | `error`, `warn`, `info` or `debug`. Logs never include note text   |

## Development

```bash
npm run dev          # API on 4317, Vite on 5173, data in ./.dev-data
npm run check        # lint, typecheck and unit tests
npm run test:e2e     # build, then Playwright (run: npx playwright install chromium)
npm run build        # typecheck, then build the web app and the server
```

| Script                                                | What it does                                                                            |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm start`                                           | Builds if `dist` is missing or out of date, starts the server, opens the browser        |
| `npm run lint`, `format`, `format:check`, `typecheck` | ESLint, Prettier and `tsc -b`                                                           |
| `npm test`                                            | Vitest: unit, integration and component tests                                           |
| `npm run check:network`                               | Fails if the source or the build contains a non-local URL                               |
| `npm run db:generate`                                 | Runs `drizzle-kit generate` after a schema change (add `--custom` for hand-written SQL) |
| `npm run db:studio`                                   | Opens Drizzle Studio on the development database only                                   |
| `npm run db:vacuum`                                   | Vacuums the journal. Stop the app first                                                 |

It is one npm package with three source folders. ESLint enforces who may import whom:

```text
src/shared   zod schemas, game dates, constants. No Node or DOM APIs
src/server   Hono API, SQLite, migrations, snapshots. Imports shared only
src/web      React app. Imports shared, plus the AppType type from server/app
```

## Where it stands

| Area               | State                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundations        | Done. Shell, server, database, backups, tooling, CI                                                                                                                                                   |
| Capture and review | Done. Notes, composer, Today, Day and Journal, game date, delete with undo                                                                                                                            |
| Structure          | Done. Discoveries, questions, `@` and `[[` links, people, farm entries, tag manager                                                                                                                   |
| Search             | Done. Full-text search with typo tolerance, command palette, shortcuts                                                                                                                                |
| Maps and templates | Done. Maps, markers, Places, "On maps", game templates, section rename, hide and reorder, quick actions                                                                                               |
| Map editor         | Done. Objects, layers, smart drawing, snapping, connectors, markers, exploring mode, history, exports                                                                                                 |
| Safety and release | Features done (export, import, settings, Recently deleted). Still to do before `v0.1.0`: the remaining end-to-end tests, performance checks on a large journal, a release workflow, and a full CI run |

## What it will not do

These are left out on purpose: image attachments, imported map images, tag colours, checklists, completion tracking, cloud sync, accounts, rich text, statistics, AI features and plugins. They are decisions, not things I have not got to yet, so requests for them will be closed.

## Privacy

- Mossnote never connects to the internet.
- What you write is stored in one file on your computer. Settings shows the path.
- Nothing is shared unless you export a file and send it yourself.
- The database is plain SQLite and is not encrypted. Use your operating system's disk encryption, such as FileVault on macOS.

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before you start, and [SECURITY.md](SECURITY.md) if you found a vulnerability. Anything that adds game-specific content will be turned down, however useful it is.

## Licence

MIT. See [LICENSE](LICENSE).

The fonts are [Literata](https://github.com/googlefonts/literata) and [Source Sans 3](https://github.com/adobe-fonts/source-sans), bundled through the `@fontsource-variable` packages under the SIL Open Font License 1.1.
