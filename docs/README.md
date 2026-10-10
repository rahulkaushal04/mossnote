# Mossnote documentation

The user documentation, published at `/docs/` next to the web version on GitHub Pages. Plain HTML, no framework, no fonts or scripts fetched from anywhere.

```text
docs/
  nav.json          Order of pages and the navigation sections
  content/          One HTML fragment per page (front matter + body)
  assets/css, js    The stylesheet and the optional search/contents script
  assets/img        Screenshots
  assets/video      Recordings
scripts/docs/
  build.ts          Wraps the fragments in the layout; writes dist/standalone/docs
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

The scripts that take the screenshots and recordings are not in the repository. They are kept locally in `local_reference/docs-capture/` (ignored by git). The pictures in `docs/assets` are plain files: replace them and run `npm run docs:build`.
