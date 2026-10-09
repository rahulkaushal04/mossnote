# Changelog

All notable changes to this project are written down here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Mossnote has not had a public
release yet, so entries are grouped by date, with the latest changes under "Unreleased".
Once releases begin they will use [Semantic Versioning](https://semver.org/).

## Unreleased

Two new ways to use Mossnote while you play. Your existing journals are untouched.

### Added

- **Phone access.** Settings → Phone lets a phone or tablet on your home network open the journal that lives on your computer. Turn it on, scan the pairing code with the phone's camera, and write notes without leaving the game. Only devices you pair can use it; you can remove them from the same screen. `mossnote --lan` or `MOSS_LAN=1` turns it on at start.
- **A web version** that keeps the journal in the browser, for people with no computer to run Mossnote on, such as a console player with a phone. It works offline, can be added to the Home Screen, reminds you to download a backup, and says plainly when a browser cannot keep files (private windows) or another tab already has the journal. Build it with `npm run build:standalone`.
- Export and download buttons work the same in both versions, and the data screens say whether the journal is in a folder or in the browser.

### Changed

- **A third pass on the look and feel.** No data, setting or shortcut changed.
- **Each game's journal wears its own colour.** A game template names a tint: Default stays moss, Stardew Valley is plum. It replaces the accent (buttons, the current item, the italic word in titles) in light and dark, and never touches the colours that mean something: red is still a warning. The journal switcher shows the dot and the game's name, and each template card previews its colour. Every tint is checked for contrast.
- Notes in the Journal and on a day: on a wide screen the date, tags and links sit in a right-hand margin, and a note no longer repeats the day that its heading or page already names. On a narrow screen they stay under the text.
- Today puts the in-game date under the title, above the note box. The note box keeps its options in one row that scrolls sideways on a phone, with Save beside it instead of dropping onto a second row, and keyboard hints such as ⌘↵ are not shown on a touch screen.
- The current page in the sidebar, rail and settings is a tinted fill with a short marker. The sidebar says "Stays on this computer" (or "in this browser"). Section names in the phone's tab bar are no longer squeezed.
- People, Farm and Maps start with one "add" row instead of a label, a field and a button. Farm groups show a count; each entry has its dates and counts on a second line. Empty pages use a larger serif sentence and a line drawing in the journal's colour.
- Secondary buttons have a hairline edge on a raised fill instead of a heavy outline. Text fields keep their strong outline.
- The map editor has its tools in a vertical strip on the left, one row of controls above, and a much taller canvas. A phone keeps the two scrolling rows.
- Settings has a side navigation that follows the section in view, from 900px up. Narrower screens keep the row of pills.
- The first screen puts a short statement and two facts (no spoilers, nothing leaves the device) beside the template cards.
- The server's code is split so the same app, services and migrations run in Node and in the browser, behind small `Sqlite` and `Storage` interfaces. The server's behaviour is unchanged; `npm run test:wasm` runs its whole test suite on the browser's SQLite.
- Settings → Data & backup shows the data location as a folder or as browser storage (`GET /api/data/info` now returns a `location` object instead of three path fields).

### Fixed

- **A map reopened as it was first created.** After renaming a map or drawing on it and going back to Maps, opening it again within a few minutes showed "Untitled map" and an empty canvas, because the editor reused a copy fetched before your changes (your work was saved, and the next edit could have overwritten it). The map now keeps what you drew and its new name, and the Maps list and Places refresh as soon as the last change is saved.
- The dotted canvas in the map editor was drawn behind the canvas and never showed. It is now a quiet dot lattice that moves and scales with the drawing, shown while the grid is off.

## 2026-10-08

A second pass on the look and feel. Nothing was removed and no data changed.

### Changed

- Page titles are large and serif, with one italic word where it reads well and a one-line intro under them. Today opens with the day's name in italic and the note box ready to type in; quick actions are pills under the box and the date controls sit below them.
- A wide screen has a floating sidebar with a search field, New note, your sections with counts, pinned tags and Settings, and the page is one centred column. A tablet has a slim icon rail. A phone has a floating bottom bar.
- Lists are quiet hairline rows with serif names; People has monogram avatars. Filters are pills, and an active filter is a pill you press to remove.
- The first screen shows each template as a large card with a clear selected state.
- The search palette has tabs for notes, people, farm entries and maps, a blurred backdrop and a row of key hints.
- The map editor has a dotted canvas and a raised toolbar. Press and hold an icon on a touch screen to see its name. The note box on Today stays in view when the keyboard opens.
- The interface font is now Inter (the reading font is still Literata). Small details: thin scrollbars, a selection colour, a browser theme colour for both themes, a new icon, print and high-contrast styles.
- The note box always shows its options (date, flags, tag, link, Save), so the page no longer jumps when you click elsewhere.
- Empty People, Farm and Maps pages show a small line drawing and a button for the next step. "Dismiss" on the date tip now reads "Hide this tip".

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
