# Changelog

All notable changes to this project are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow
[Semantic Versioning](https://semver.org/). Mossnote is in beta: until a stable `1.0.0`, a beta
such as `0.1.0-beta.1` is published to npm under the `beta` tag, and a GitHub release for it is
marked as a prerelease. Changes made since the last tag go under "Unreleased".

## Unreleased

## 0.1.0-beta.1

The first release. Mossnote is a local-first, spoiler-free journal for the games you play: your
notes stay on your computer (or in your browser), nothing is sent anywhere, and a template holds
wording and structure only, never game information.

### Journal

- Notes with a composer that saves on Cmd/Ctrl+Enter, keeps drafts through a refresh or an outage, and stamps each note with the current game date. Notes can be edited in place; the editor stays open, with a "Discard changes" choice, if a save fails or a newer version is waiting.
- Today, Day and Journal views with filters for discoveries, questions, tags, people, date ranges and undated notes. On a wide screen the date, tags and links of a note sit in a right-hand margin.
- Discoveries and questions. A question can be left open, marked solved or ignored, and given an answer.
- People and farm entries, each page built from the notes that mention it. `@person`, `[[farm entry]]`, `#tag` and `/` pickers create records as you type, and keep what you typed meanwhile if creating one fails. The editors say when a change could not be saved.
- A tag manager (rename, pin, merge, delete) and suggestions for field labels. Tags and people ignore case and accents (`#cafe` finds `café`).
- An editable game calendar, with checks when a change would affect existing dates.

### Maps

- A map editor built on SVG: freehand paths, boxes, circles, areas, connectors, text, cards, callouts, sticky notes and markers, on named layers. Tools sit in a vertical strip beside a tall canvas with a dot lattice that moves and scales with the drawing.
- Smart drawing that turns rough strokes into clean shapes, with an offer to keep the original.
- Snapping to points, edges, alignment lines, angles and the grid, which Alt pauses. Guides, grid, rulers, minimap, compass and a measure tool.
- Select, move, resize, rotate, group, lock, hide, rename, align, distribute, copy, paste and duplicate, with a quick bar, a right-click menu and keyboard shortcuts. A full map says so instead of failing to save later.
- Markers with an icon, status, tags and fields, and a link to a note, a person or a farm entry. The linked page lists them under "On maps". Marker types are yours to define.
- Exploring mode, for switching between the game and the map.
- Autosave in a single request, undo and redo, and version history with automatic and named versions. Leaving a map right after an edit does not lose it, and if the map was changed in another window or on another device, saving stops and asks: Reload takes the other copy, Keep mine saves yours over it.
- Duplicate a map. Export to PNG, SVG, PDF or an editable project file (`.mossmap.json`) that can be opened again. Maps with a lot of non-English text can be saved.
- A Places list across all maps.

### Game templates

- A default template and one for Stardew Valley. A template holds wording and structure only, never game information.
- Rename, hide and reorder sections, quick actions above the note box, and one-click suggested tags, all under Settings.
- Each game's journal wears its own colour: Default stays moss, Stardew Valley is plum. It replaces the accent in light and dark, never touches the colours that mean something (red is still a warning), and every tint is checked for contrast.

### Search

- Full-text search on SQLite FTS5 with typo tolerance, `#tag`, `@person`, quoted phrases and `-word` exclusion (`lantern -cave -river` hides notes that have either word), a command palette on Cmd/Ctrl+K (also while typing in the note box), a results page, and a shortcuts dialog.

### Phone access

- Settings → Phone lets a phone or tablet on your home network open the journal that lives on your computer. Turn it on, scan the pairing code with the phone's camera, and write notes without leaving the game. Only devices you pair can use it, and you can remove them from the same screen. Switching it off never leaves the network open without a pairing. `mossnote --lan` or `MOSS_LAN=1` turns it on at start.

### Web version

- A version that keeps the journal in the browser, for people with no computer to run Mossnote on, such as a console player with a phone. It works offline, can be added to the Home Screen, reminds you to download a backup, and says plainly when a browser cannot keep files (private windows) or another tab already has the journal. Build it with `npm run build:standalone`.
- Published to GitHub Pages by the _Web version_ workflow, on every push to `main` and by hand, together with the documentation at `/docs/`. The workflow works out the base path for a project site, a `<owner>.github.io` site or a custom domain, and publishes only after the finished site passes `npm run verify:pages`.
- Export and download buttons work the same in both versions, and the data screens say whether the journal is in a folder or in the browser.

### Safety

- JSON and Markdown export. Import validates the file, runs in one transaction, takes a snapshot first, says what it replaces (template, calendar, and map version history), and refuses a file that names an unknown template or holds a drawing that is too large.
- Automatic and manual snapshots, an integrity check on every start, and Recently deleted with a 30-day purge.
- A lock left from before the computer started no longer stops Mossnote from starting, and the message names the file to delete if a crash left one behind.
- Creating something with the id of a deleted note, person, farm entry or map is refused with a clear message.
- Settings for theme, reading size, calendar, game, sections and data.

### Look and feel

- Large serif page titles, hairline list rows, a floating sidebar on wide screens, a search palette with tabs, light, dark and system themes, Inter for the interface and Literata for reading, bundled fonts, empty states with a line drawing, toasts and dialogs.
- The first screen shows each template as a card, with a short statement and two facts (no spoilers, nothing leaves the device). Settings has a side navigation from 900px up.
- Touch screens get a bottom tab bar, a note box whose options scroll sideways, and press-and-hold names for map tools.

### Install and run

- **npm:** `npx mossnote@beta`. The supported Node is 22.14 or newer, with no upper limit. The command line is strict: an unknown option or word is reported (a typo such as `--prot` does not start on the default port), `--port=4000` works, and mistakes name the option. An empty `MOSS_DATA_DIR=` counts as not set, an installed copy is always a production run, and the version is read from the package's own `package.json`. Startup problems say what to do: a data folder that cannot be used names the folder and `--data-dir`, and a busy port names `--port`.
- **Linux and Windows programs:** one self-contained file for Linux x64, Linux arm64 and Windows x64, with no Node.js needed. Each is built, run and checked on its own system by the `binaries.yml` workflow, and the Linux ones are also run in clean Ubuntu 22.04 and 24.04, Debian 12 and Fedora containers on both architectures. The minimum Linux is glibc 2.34 and the C++ library of GCC 11, measured from the SQLite module; the build fails if either number rises. Alpine and older systems are not supported. First-run unpacking tries again on Windows when an antivirus scanner is still reading the new files, says why when it fails, and removes half-finished unpacks. The Windows program is not code-signed; the README says what SmartScreen does and how to proceed.
- **Python:** `pip install mossnote` and `pipx install mossnote`, with no Node.js needed. One wheel (`py3-none-any`, about 12 MB) carries the app, its production dependencies and the SQLite module for every system, and runs on the Node.js from `nodejs-wheel-binaries`. The beta is `0.1.0b1` to pip and `0.1.0-beta.1` everywhere else.
- Every route stops cleanly on Ctrl+C and when its terminal window is closed (SIGHUP, and Ctrl+Break on Windows).
- Checks as a stranger would get it: `npm run package:npm-smoke` installs the real tarball into an empty project and a global prefix; `npm run package:smoke` unpacks the program from a folder with a space in its name with no Node.js on the `PATH`; `python/tests/wheel_smoke.py` installs the wheel into an empty environment; `npm run package:checksums` verifies every `.sha256`.
- The release workflow marks a version with a `-` as a prerelease, attaches exactly the files it tested to a draft release created after every program passed, and publishes the tested tarball under the dist-tag named after the `-` (never `latest`). `pypi.yml` publishes with trusted publishing. `CONTRIBUTING.md` lists what the maintainer needs before the first publish.

### Under the hood

- One npm package with `shared`, `server` and `web` source folders, and ESLint rules that enforce who may import whom.
- A Hono server on loopback only, with Host and Origin checks, a required header on writes, strict security headers and a per-response style nonce, and one JSON error shape.
- SQLite with Drizzle migrations, a hand-written full-text search migration, WAL mode, foreign keys, a PID lock file and snapshot retention. The same app, services and migrations run in Node and in the browser behind small `Sqlite` and `Storage` interfaces; `npm run test:wasm` runs the whole server test suite on the browser's SQLite.
- No outgoing network connections. A check fails the build if the source or the output contains a non-local URL.
- Tests: unit, integration and component tests, and Playwright end-to-end tests with axe accessibility scans in both themes and a run under the full Content-Security-Policy.
- GitHub Actions on Node 22, 24 and 26, a WebKit smoke test on macOS, Dependabot, issue forms and a pull request template.
- README, CONTRIBUTING, SECURITY and a Code of Conduct.
