# Mossnote

A private journal for one player and one game, kept on your own computer.

You write down what you find out, in your own words. Mossnote only remembers it for you. It ships with no information about any game, so it can never spoil anything.

## What it promises

- **No spoilers.** There are no names, items, places or mechanics anywhere in the app. A new journal is empty. A template only changes wording and structure, and the only calendar that looks like a game (four editable seasons) belongs to the Stardew Valley template alone.
- **Your data stays with you.** Each journal is one SQLite file in a folder on your machine, and upgrading or reinstalling Mossnote never touches that folder.
- **No network.** The server listens on loopback only and makes no outgoing connections. There are no accounts, analytics, crash reports or update checks. Fonts and other assets are bundled.

## Quick start

Pick whichever way suits you. They all run the same app, open your browser at `http://127.0.0.1:4317` and keep your journals in the same folder (see [Where your data lives](#where-your-data-lives)).

**With Node (22.12 or newer):**

```bash
npx mossnote                # try it
npm install -g mossnote     # or install it, then run:
mossnote
```

`mossnote --help` lists the options: `--port`, `--data-dir`, `--journal`, `--no-open`.

**Without Node:** download the program for your system from the [releases page](https://github.com/rahulkaushal04/mossnote/releases), check it against its `.sha256` file, and run it.

| System  | Download                           | Run                                                        |
| ------- | ---------------------------------- | ---------------------------------------------------------- |
| Windows | `mossnote-vX.Y.Z-win-x64.exe`      | Double-click it. A console window shows that it is running |
| Linux   | `mossnote-vX.Y.Z-linux-x64.tar.gz` | `tar -xzf` the file, then `./mossnote`                     |

The programs are not code-signed, so Windows SmartScreen may ask you to confirm the first run ("More info", then "Run anyway"). The first start unpacks the app into a cache folder (about 10 MB, code only) and later starts reuse it. Close the window or press Ctrl+C to stop Mossnote.

**From a clone:**

```bash
git clone https://github.com/rahulkaushal04/mossnote.git
cd mossnote
npm install
npm start
```

`npm start` builds the app if it has to, starts the server and opens your browser.

The first time you open Mossnote it asks one question, **Which template?** Default fits any game; Stardew Valley adds a Farm section, a calendar of seasons and a few one-tap actions. Pick one, give the journal a name, and you are writing. Don't see your game? The same screen links to a form for requesting a template.

## Journals and templates

Keep one journal for each game, or each playthrough. Every journal has its own notes, people, maps, calendar and sections, and its own template, and they sit side by side in your data folder.

- The journal switcher is at the top of the left rail. In a narrow window (a phone-sized browser) it is under the **More** tab, with Settings. It lists your journals and lets you switch, make a new one, or rename the current one. Settings → Journals lists them all with Open, Rename, Download and Delete.
- A **template** is chosen when a journal is made and stays with it. **Default** has Today, Journal, People and Maps and counts days ("Day 12"). **Stardew Valley** adds a Farm section, a calendar of four seasons, and quick actions and suggested tags. Neither carries any facts about a game, only wording and structure. To use another template, make another journal.
- Deleting a journal asks you to type its name, offers a copy to download first, and keeps a last copy in your backups folder unless you switch that off.
- Journals made by earlier versions open as they were. They are read as Stardew Valley journals, because the seasons and the Farm section they used now belong to that template.

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
- In a narrow or touch window the editor uses the whole screen, with an icon toolbar you can hide, pinch to zoom, and handles that are easy to grab.
- Version history, duplicate a map, and export to PNG, SVG, PDF or an editable project file.

The maps are your own drawings. Nothing about any game comes with them.

**Pick a game.** A journal's template sets its wording (for example "NPCs" and "Daily journal"), its calendar and, for Stardew Valley, a few one-tap actions above the note box. You can rename, hide and reorder sections, or turn a pinned tag into a section of your own. A template holds vocabulary and structure only.

**Search.** Cmd/Ctrl+K opens a palette with full-text search that forgives typos. The results page understands `#tag`, `@person` and "quoted phrases". Maps and markers match on plain text.

**Stay safe.** Export any journal as JSON or Markdown, import a file (it replaces that journal, after a snapshot is taken), automatic and manual snapshots that you can restore or delete from Settings, and 30 days of Recently deleted. Deleting a note, person, entry or map can be undone for a few seconds, and from Recently deleted after that.

Press `?` inside the app to see the keyboard shortcuts.

## Where your data lives

Each journal is one file in a folder just for you. The folder is created with mode 0700 and the databases with mode 0600. Settings → Data & backup shows the exact path, the journal's size and snapshots, and has an **Open folder** button.

| Platform | Default folder                                                  |
| -------- | --------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Mossnote/`                       |
| Linux    | `$XDG_DATA_HOME/mossnote/` (default `~/.local/share/mossnote/`) |
| Windows  | `%APPDATA%\Mossnote\`                                           |

```text
my-journal.db      a journal (and my-journal.db-wal and -shm while it is open)
farm-game.db       another one, beside it
my-journal.lock    stops a second copy of Mossnote from opening the same journal
active-journal     which journal was open last
backups/           snapshots of every journal
```

Your journals are **never** stored beside the program, in `node_modules`, or in the folder the downloaded program unpacks itself into (a cache of code that is safe to delete). So installing, upgrading, reinstalling or deleting Mossnote, by any of the ways above, leaves your journals alone.

### Upgrading

Install the new version the way you installed the old one: run `npx mossnote` again, `npm install -g mossnote@latest`, replace the downloaded program, or `git pull` and `npm start`. Mossnote does not check for updates and never connects to the internet.

- The first time a journal is opened by a newer version it is brought up to date automatically, after a snapshot called `pre-migration`. Nothing to click.
- A journal made by a **newer** version than the one you are running is not opened and not changed. Mossnote says "This journal was made by a newer version of Mossnote. Update Mossnote to open it." and opens your other journals. Update, and it opens.
- Going back to an older version is not supported. If you must, restore the `pre-migration` snapshot from `backups/`.

### Snapshots

Snapshots use SQLite's online backup, so they are safe to take while the app is running. Copying a `.db` file by hand is not a safe backup, because the write-ahead log may hold recent changes.

| Reason          | When                                                | How many are kept (per journal)    |
| --------------- | --------------------------------------------------- | ---------------------------------- |
| `auto`          | At start, if the newest one is over 24 hours old    | The newest 14 (`MOSS_BACKUP_KEEP`) |
| `pre-migration` | Before an upgrade changes an existing journal       | The newest 3                       |
| `pre-import`    | Before an import replaces the journal               | The newest 5                       |
| `pre-restore`   | Before a snapshot is restored over the journal      | The newest 5                       |
| `manual`        | When you ask for one, and when you delete a journal | All of them                        |

Settings → Data & backup lists the snapshots of the open journal. **Restore** puts the journal back to that moment (after saving it as it is now, so you can come back) and **Delete** removes one snapshot file.

Every start runs an integrity check. If it fails, the server refuses to start and tells you which snapshot is newest. To restore by hand:

1. Stop Mossnote.
2. Copy a snapshot from `backups/` over the journal's `.db` file.
3. Delete that journal's `.db-wal` and `.db-shm` files.
4. Start Mossnote again.

## Configuration

All settings are environment variables that start with `MOSS_`. None are required. [`.env.example`](.env.example) lists them with comments.

| Variable            | Default          | What it does                                                                                                                            |
| ------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `MOSS_HOST`         | `127.0.0.1`      | Address to listen on. Must be loopback                                                                                                  |
| `MOSS_PORT`         | `4317`           | HTTP port                                                                                                                               |
| `MOSS_DATA_DIR`     | platform default | Where the data folder is                                                                                                                |
| `MOSS_JOURNAL`      | not set          | File name without `.db` of the journal to open at start (made from Default if missing). Unset, Mossnote opens the journal you used last |
| `MOSS_BACKUP_KEEP`  | `14`             | How many automatic snapshots to keep                                                                                                    |
| `MOSS_OPEN_BROWSER` | `1`              | Set to `0` to stop it opening a browser                                                                                                 |
| `MOSS_LOG_LEVEL`    | `info`           | `error`, `warn`, `info` or `debug`. Logs never include note text                                                                        |

## Building the downloads yourself

The Windows and Linux programs are Node itself with the app inside it (Node's single executable support; see decision 0006). The SQLite module is native, so each program is built on its own system: no cross-compiling.

```bash
npm ci
npm run build
npm run package:binary                           # writes release/mossnote-v<version>-<system>...
npm run package:smoke -- build/package/mossnote  # starts it and checks it works (mossnote.exe on Windows)
```

You need Node 22.12 or newer and a network connection for the build (the native module is fetched for your system). Pushing a tag such as `v0.2.0` runs [`release.yml`](.github/workflows/release.yml): it checks the code, builds and tests the program on a Windows and a Linux runner, attaches them to a draft release, publishes the npm package if the repository variable `PUBLISH_TO_NPM` is `true` (with an `NPM_TOKEN` secret), and then publishes the release. To check the npm package by hand: `npm pack`, then install the `.tgz` in an empty folder and run `npx mossnote`.

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
| `npm run db:vacuum`                                   | Vacuums every journal (or `MOSS_JOURNAL`). Stop the app first                           |
| `npm run package:binary`, `package:smoke`             | Build and test the standalone program for this system                                   |

It is one npm package with three source folders. ESLint enforces who may import whom:

```text
src/shared   zod schemas, game dates, constants. No Node or DOM APIs
src/server   Hono API, SQLite, migrations, snapshots. Imports shared only
src/web      React app. Imports shared, plus the AppType type from server/app
```

## What is in it

| Area               | What it covers                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------- |
| Foundations        | Shell, server, database, backups, tooling, CI                                                       |
| Capture and review | Notes, composer, Today, Day and Journal, game date, delete with undo                                |
| Structure          | Discoveries, questions, `@` and `[[` links, people, farm entries, tag manager                       |
| Search             | Full-text search with typo tolerance, command palette, shortcuts                                    |
| Maps and templates | Maps, markers, Places, "On maps", game templates, section rename, hide and reorder, quick actions   |
| Journals           | Many journals side by side, a template for each, switcher, rename, delete with a typed name         |
| Distribution       | `npx mossnote`, an npm package, standalone Windows and Linux programs, a release workflow           |
| Upgrades           | Automatic migration after a snapshot, newer journals left untouched, earlier layout loads as it was |
| Map editor         | Objects, layers, smart drawing, snapping, connectors, markers, exploring mode, history, exports     |
| Safety             | Export, import, settings, snapshots you can restore and delete, Recently deleted                    |

## What it will not do

These are left out on purpose: image attachments, imported map images, tag colours, checklists, completion tracking, cloud sync, accounts, rich text, statistics, AI features and plugins. They are decisions, not things I have not got to yet, so requests for them will be closed.

## Privacy

- Mossnote never connects to the internet.
- What you write is stored in one file per journal on your computer. Settings shows the path.
- Nothing is shared unless you export a file and send it yourself.
- The database is plain SQLite and is not encrypted. Use your operating system's disk encryption, such as FileVault on macOS.

## Contributing and security

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before you start, and [SECURITY.md](SECURITY.md) if you found a vulnerability. Anything that adds game-specific content will be turned down, however useful it is.

## Licence

MIT. See [LICENSE](LICENSE).

The fonts are [Literata](https://github.com/googlefonts/literata) and [Source Sans 3](https://github.com/adobe-fonts/source-sans), bundled through the `@fontsource-variable` packages under the SIL Open Font License 1.1.
