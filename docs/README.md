# Mossnote documentation

The user documentation, published at `/docs/` next to the web version on GitHub Pages. Plain HTML, no framework, no fonts or scripts fetched from anywhere.

```text
docs/
  nav.json          Order of pages and the navigation sections
  content/          One HTML fragment per page (front matter + body)
  assets/css, js    The stylesheet and the optional search/contents script
  assets/img        Screenshots (made by scripts/docs/capture.ts)
  assets/video      Recordings (made by scripts/docs/capture.ts)
scripts/docs/
  build.ts          Wraps the fragments in the layout; writes dist/standalone/docs
  capture.ts        Drives the real app and takes every screenshot and recording
  lib.ts            Browser, annotation and cursor helpers for capture.ts
```

## Build and preview

```bash
npm run build:standalone     # the web version
npm run docs:build           # adds dist/standalone/docs
npm run preview:standalone   # http://127.0.0.1:4318/ and /docs/
```

For the GitHub project-site path, build with `MOSS_BASE=/mossnote/ npm run build:standalone` first. All addresses in the docs are relative, so any base path works. `docs:build` fails on a broken link, a missing heading target or a missing picture. The `Web version` workflow runs it after the outbound-URL check.

## Writing a page

1. Create `docs/content/<slug>.html` starting with front matter:

   ```html
   ---
   title: Page title
   description: One sentence for the page header and search results.
   ---
   ```

2. List `<slug>` in `docs/nav.json`.
3. Write plain HTML. Extras the build understands:
   - `~/slug/` in an `href`, `src` or `poster` means the docs folder, whatever the page depth. Use `~/slug/#heading` for a heading.
   - `<shot name="file" alt="…">Caption</shot>` for `assets/img/file.png` (size is read from the file).
   - `<clip name="file" alt="…">Caption</clip>` for `assets/video/file.webm` (uses `file-poster.png`).
   - `<status kind="implemented|partial|limitation|unverified|idea"></status>` for a badge.
   - `<callout type="note|tip|warning|limit" title="…">…</callout>`.
   - `<h2>` and `<h3>` get ids, permalinks and the contents list automatically.
4. Say what you verified. If you could not run something, mark it `unverified`.

## Pictures and recordings

Start the web version (`npm run preview:standalone`), then:

```bash
npm run docs:capture                    # everything
npm run docs:capture -- maps notes      # some scenes (names are in capture.ts)
```

Computer-version scenes (`server-data`, `server-phone`) need `npm run build && npm start` and `DOCS_APP_URL=http://127.0.0.1:4317`. Orange numbered boxes are drawn on the live page for the picture and removed again; the caption says what each number is. Never add a number without saying what it means.

Notes: Playwright sends Cmd+K before the app is listening on a freshly loaded page, and the app ignores it inside text boxes, so the scenes press Esc first. Videos are WebM (VP8) from Playwright; there is no `ffmpeg` requirement.

## Deployment compatibility

The app's service worker (`scripts/vite/sw.template.js`) lets page loads under `docs/` go to the network. Without that, a visitor who had already opened the app would get the app instead of the docs. The docs are not precached for offline use.
