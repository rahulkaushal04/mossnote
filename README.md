<p align="center">
  <img src="docs/assets/brand/mossnote-logo.svg" alt="Mossnote" width="360">
</p>

[![CI](https://github.com/rahulkaushal04/mossnote/actions/workflows/ci.yml/badge.svg)](https://github.com/rahulkaushal04/mossnote/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-22%2B-brightgreen.svg)](.nvmrc)

A private, spoiler-free journal for the games you play.

You write down what you find out, in your own words, and Mossnote remembers it for you. It ships with no information about any game, so it can never spoil anything. It runs on your own computer, or in your own browser, and it never sends your notes anywhere.

- **No spoilers.** There are no names, items, places or mechanics anywhere in the app. A new journal is empty.
- **Your data stays with you.** Each journal is one file in a folder on your computer (or one database in your browser, in the web version).
- **No accounts, no tracking.** Nothing is uploaded. There are no analytics, crash reports or update checks.
- **Made for playing.** Write on the same screen, or on a phone or tablet beside the game.

<p align="center">
  <img src="docs/assets/readme/today-default.png" alt="Mossnote's Today screen: a note box with date, flag, tag and link options, and the day's notes below, with a sidebar listing Today, Journal, People and Maps." width="860">
</p>

![A recording of writing a note: setting the in-game day, mentioning a person with @, adding a tag with #, flagging a question and saving.](docs/assets/readme/quick-capture.gif)

_Writing a note: set the in-game day, mention a person with `@`, add a tag with `#`, flag a question and save. A [full-quality recording](docs/assets/video/video-quick-capture.webm) is also in the repository._

> **Status:** Mossnote has not had a public release yet. Until it does, [run it from source](#run-it-from-source). The `npx` and download options below will work once the first release is published.

## Documentation

Guides, tutorials and reference live in [`docs/`](docs/README.md) and are published at `/docs/` next to the web version (build them with `npm run docs:build`).

## Contents

- [Ways to use it](#ways-to-use-it)
- [Install](#install) · [Phone access](#use-a-phone-or-tablet-while-you-play) · [Web version](#the-web-version)
- [Your first journal](#your-first-journal)
- [Features](#features)
- [Your data and backups](#your-data-and-backups)
- [Configuration](#configuration)
- [Development](#development)
- [Help, security and contributing](#help-security-and-contributing)

## Ways to use it

| You play on                     | Use                                                                     | Your journal is kept        |
| ------------------------------- | ----------------------------------------------------------------------- | --------------------------- |
| A PC or laptop, notes on it too | [Node](#with-node) or the [program](#without-node)                      | In a folder on the computer |
| A PC or laptop, notes on phone  | The same, with [phone access](#use-a-phone-or-tablet-while-you-play) on | In a folder on the computer |
| A console, notes on a phone     | The [web version](#the-web-version) on the phone                        | In the phone's browser      |

A journal kept on a computer and one kept in a browser are separate. To move one, export it and import the file on the other side (Settings → Data & backup).

## Install

### With Node

You need [Node.js](https://nodejs.org) 22.12 or newer.

```bash
npx mossnote              # try it
npm install -g mossnote   # or install it, then run:
mossnote
```

Your browser opens at `http://127.0.0.1:4317`. Run `mossnote --help` for the options: `--port`, `--data-dir`, `--journal`, `--no-open` and `--lan`.

### Without Node

Download the program for your system from the [releases page](https://github.com/rahulkaushal04/mossnote/releases), check it against its `.sha256` file, and run it.

| System  | File                               | How to run                                                 |
| ------- | ---------------------------------- | ---------------------------------------------------------- |
| Windows | `mossnote-vX.Y.Z-win-x64.exe`      | Double-click it. A console window shows that it is running |
| Linux   | `mossnote-vX.Y.Z-linux-x64.tar.gz` | `tar -xzf` the file, then `./mossnote`                     |

The programs are not code-signed, so Windows SmartScreen may ask you to confirm the first run ("More info", then "Run anyway"). Close the window or press Ctrl+C to stop Mossnote. macOS users can use the Node route.

### Run it from source

```bash
git clone https://github.com/rahulkaushal04/mossnote.git
cd mossnote
npm install
npm start
```

`npm start` builds the app if it has to, starts the server and opens your browser.

### Upgrading

Install the new version the same way you installed the old one. Your journals live in your user folder, never beside the program, so upgrading or reinstalling never touches them.

- A journal is brought up to date automatically the first time a newer version opens it, after a snapshot called `pre-migration`.
- A journal made by a **newer** version than the one you run is left untouched and not opened. Mossnote tells you to update.
- Going back to an older version is not supported. If you must, restore the `pre-migration` snapshot.

## Use a phone or tablet while you play

If you play on the computer that runs Mossnote, you can write in your journal on a phone or tablet instead of switching windows. The journal stays on the computer. The phone opens it over your home network.

1. Start Mossnote on the computer and open **Settings → Phone**.
2. Turn on **Let phones and tablets on my network open Mossnote**. If the computer asks about a firewall, allow Mossnote on private networks.
3. Choose **Show pairing code**. On the phone, on the same Wi-Fi, scan the QR code with the camera and open the link. Or open the address shown and type the code.
4. The phone is paired. Add it to the Home Screen if you like. Remove a phone later from the same screen.

<img src="docs/assets/readme/phone.png" alt="Mossnote on a phone-width screen: the note box fills the width and a bar at the bottom lists Today, Journal, People, Maps and More." width="240" align="right">

Good to know:

- Only paired devices can use it. A code works once and expires after ten minutes. Paired phones cannot change phone access.
- The connection is plain HTTP, so use it only on a network you trust, such as your home Wi-Fi.
- The computer must be on and running Mossnote. If the phone cannot reach it, a guest or "client isolation" Wi-Fi network is the usual cause.
- `mossnote --lan` (or `MOSS_LAN=1`) turns it on at start. `MOSS_LAN=0` keeps it off whatever Settings says.

## The web version

The web version is the same app with the server built into the page. Your journals are kept in the browser's own storage, nothing is sent anywhere, and it works offline once it has loaded. It is for people with no computer to run Mossnote on, such as a console player with a phone.

Build it with `npm run build:standalone` and put `dist/standalone` on any static host. For a project site, set `MOSS_BASE=/repository-name/` before building. Open it in Safari, Chrome, Edge or Firefox.

- **Add it to the Home Screen** (Share → Add to Home Screen on iPhone and iPad, or the install prompt on Android). Browsers keep an installed app's data more carefully.
- **Back it up.** The journal lives only in that browser on that device. Clearing the site's data, or losing the device, loses it. Download a copy now and then (Settings → Data & backup). Mossnote reminds you.
- **One tab at a time.** A second tab says so instead of risking two writers.
- **Private windows cannot keep files**, and Mossnote tells you so.
- There is no sync between devices. Move a journal by exporting it and importing the file.

## Your first journal

The first time you open Mossnote it asks one question: **Which template?** Pick one, name your journal, and start writing.

- **Default** fits any game. It has Today, Journal, People and Maps, and counts days ("Day 12").
- **Stardew Valley** adds a Farm section, a calendar of four seasons, and a few one-tap actions.

| Default                                                                                                                         | Stardew Valley                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| <img src="docs/assets/readme/today-default.png" alt="Today in a Default journal: four sections and a day counter." width="420"> | <img src="docs/assets/readme/today-stardew.png" alt="Today in a Stardew Valley journal: a plum colour scheme, a Farm section, a season date, and four quick-action buttons under the note box." width="420"> |

A template only changes wording and structure. It carries no facts about a game, and it stays with the journal. To use another template, make another journal. Don't see your game? The same screen links to a form for requesting one.

Keep one journal per game or playthrough. The journal switcher is at the top of the sidebar (under **More** on a small screen). Press `?` in the app to see the keyboard shortcuts.

## Features

- **Write quickly.** Today opens with the note box ready. Save with Cmd/Ctrl+Enter. Drafts survive a refresh.
- **Link as you type.** `#tag`, `@person` and `[[farm entry]]` create things on the spot.
- **Look back.** Today, Day and Journal views, with filters for discoveries, questions, tags, people and dates. Undo a delete.
- **Questions.** Mark a note as a question, then leave it open or solve it with your own answer.
- **People and farm entries.** Pages built only from what you recorded.
- **Maps.** A small drawing tool for the places you explore, with markers that link back to your notes. Export to PNG, SVG, PDF or an editable file.
- **Search.** Cmd/Ctrl+K opens full-text search that forgives typos.
- **Many journals.** One per game, each with its own notes, calendar and sections.
- **Stay safe.** Export as JSON or Markdown, import a file, snapshots you can restore, and 30 days of Recently deleted.
- **Works on any screen.** Sidebar on a wide screen, rail on a tablet, bottom bar on a phone. Light and dark themes. Fully usable by keyboard.

![The map editor with a small hand-drawn map: boxes, an area, a sticky note and two named markers, with the tool strip on the left and style options on the right.](docs/assets/readme/map.png)

The [documentation](docs/README.md) has a guide for each of these, step-by-step tutorials and a feature-by-feature reference.

## Your data and backups

Each journal is one SQLite file in a folder just for you. Settings → Data & backup shows the exact path and has an **Open folder** button.

| Platform | Default folder                                                  |
| -------- | --------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Mossnote/`                       |
| Linux    | `$XDG_DATA_HOME/mossnote/` (default `~/.local/share/mossnote/`) |
| Windows  | `%APPDATA%\Mossnote\`                                           |

Inside it: one `<name>.db` per journal, a `backups/` folder of snapshots, and a few small bookkeeping files. Change the folder with `--data-dir` or `MOSS_DATA_DIR`. The database is plain SQLite and is **not encrypted**, so use your system's disk encryption.

### Snapshots

A snapshot is a full copy of a journal at one moment. They are safe to take while the app runs. Do not copy a `.db` file by hand as a backup, because recent changes may still be in the write-ahead log.

| Reason          | When                                         | Kept (per journal)                 |
| --------------- | -------------------------------------------- | ---------------------------------- |
| `auto`          | At start, if the newest is over 24 hours old | The newest 14 (`MOSS_BACKUP_KEEP`) |
| `pre-migration` | Before an upgrade changes a journal          | The newest 3                       |
| `pre-import`    | Before an import replaces the journal        | The newest 5                       |
| `pre-restore`   | Before a snapshot is restored                | The newest 5                       |
| `manual`        | When you ask, and when you delete a journal  | All of them                        |

Settings → Data & backup lists them. **Restore** puts the journal back to that moment, after saving it as it is now.

Every start runs an integrity check. If it fails, Mossnote refuses to start and names the newest snapshot. To restore by hand: stop Mossnote, copy the snapshot from `backups/` over the journal's `.db` file, delete that journal's `.db-wal` and `.db-shm` files, and start again.

## Configuration

Everything is optional. Settings are environment variables that start with `MOSS_`; [`.env.example`](.env.example) lists them with comments.

| Variable            | Default          | What it does                                                                 |
| ------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `MOSS_PORT`         | `4317`           | Port to listen on                                                            |
| `MOSS_DATA_DIR`     | platform default | Where the data folder is                                                     |
| `MOSS_JOURNAL`      | not set          | Journal (file name without `.db`) to open at start. Unset: the one used last |
| `MOSS_LAN`          | not set          | `1` allows paired phones, `0` never. Unset: the choice saved in Settings     |
| `MOSS_BACKUP_KEEP`  | `14`             | How many automatic snapshots to keep                                         |
| `MOSS_OPEN_BROWSER` | `1`              | `0` stops it opening a browser                                               |
| `MOSS_LOG_LEVEL`    | `info`           | `error`, `warn`, `info` or `debug`. Logs never include note text             |
| `MOSS_HOST`         | `127.0.0.1`      | Address to listen on. Must be loopback                                       |

## Development

You need Node 22.12 or newer (`.nvmrc` has the version used in development).

```bash
npm install
npx playwright install chromium   # once, for the end-to-end tests
npm run dev                       # API on 4317, Vite on 5173, data in ./.dev-data
npm run check                     # lint, typecheck and unit tests
npm run test:e2e                  # build, then Playwright
```

| Script                                     | What it does                                                            |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `npm start`                                | Builds if needed, starts the server, opens the browser                  |
| `npm run build`                            | Typechecks, then builds the web app and the server                      |
| `npm run lint` / `format` / `format:check` | ESLint and Prettier                                                     |
| `npm test`                                 | Unit, integration and component tests (Vitest)                          |
| `npm run test:wasm`                        | The server's tests on SQLite in WebAssembly, the web version's database |
| `npm run build:standalone`                 | Builds the web version into `dist/standalone`                           |
| `npx playwright test --project=standalone` | End-to-end tests of the web version (build it first)                    |
| `npm run check:network`                    | Fails if the source or the build contains a non-local URL               |
| `npm run db:generate`                      | Generates a migration after a schema change                             |
| `npm run package:binary` / `package:smoke` | Build and test the Windows or Linux program for this system             |

The source has four folders, and ESLint enforces who may import whom:

```text
src/shared      Schemas, game dates, constants. No Node or DOM APIs
src/server      Hono API, SQLite, migrations, snapshots
src/standalone  The server's app running in a browser worker, for the web version
src/web         The React app
```

The app and its services are written once and run in both Node and the browser. Only the parts that touch files differ, behind two small interfaces: `Sqlite` (the connection) and `Storage` (where journals and snapshots live).

### Releases

Pushing a tag such as `v0.2.0` runs [`release.yml`](.github/workflows/release.yml). It checks the code, builds and tests the Windows and Linux programs, and attaches them to a draft release. It publishes the npm package if the repository variable `PUBLISH_TO_NPM` is `true` (with an `NPM_TOKEN` secret), then publishes the release. The programs are Node with the app inside it, built on each system because SQLite is a native module.

## What it will not do

These are left out on purpose: image attachments, imported map images, tag colours, checklists, completion tracking, cloud sync, accounts, rich text, statistics, AI features and plugins. They are decisions, not a backlog, so requests for them will be closed.

## Privacy

- Mossnote never sends your notes anywhere. Phone access is off until you turn it on, and then only lets devices you paired reach your own computer.
- What you write is stored in one file per journal on your computer (or in your browser, in the web version).
- Nothing is shared unless you export a file and send it yourself.

## Help, security and contributing

- **Need help?** See [SUPPORT](.github/SUPPORT.md).
- **Found a vulnerability?** Report it privately, as described in [SECURITY](SECURITY.md).
- **Want to contribute?** Read [CONTRIBUTING](CONTRIBUTING.md) first. In short: open an issue before a big change, and never add game-specific content.
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Changes are listed in the [changelog](CHANGELOG.md).

## Licence

MIT. See [LICENSE](LICENSE).

The fonts are [Literata](https://github.com/googlefonts/literata) and [Inter](https://github.com/rsms/inter), bundled through the `@fontsource-variable` packages under the SIL Open Font License 1.1. The web version also bundles [SQLite WebAssembly](https://github.com/sqlite/sqlite-wasm) (Apache-2.0).
