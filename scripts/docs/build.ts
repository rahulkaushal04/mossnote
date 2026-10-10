import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the documentation site into `dist/standalone/docs` (or the folder given as the first
 * argument), so it is served at `/docs/` next to the web version on GitHub Pages. There is no
 * documentation framework: the pages are HTML fragments in `docs/content`, wrapped in one layout
 * here. See `docs/README.md` for how to add or change a page.
 *
 *   npm run docs:build
 *
 * Authors write plain HTML plus a few shorthand elements (`<shot>`, `<clip>`, `<status>`,
 * `<callout>`) and `~/` in a link or image address, which stands for "the docs folder" however
 * deep the page is. Every address in the output is relative, so the site works from any base
 * path (`/`, `/mossnote/`) and from a file system.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(root, 'docs');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'standalone', 'docs'));

interface NavSection {
  section: string;
  pages: string[];
}

interface Page {
  slug: string;
  title: string;
  description: string;
  body: string;
  /** Name of the section in the navigation. */
  section: string;
  headings: { level: 2 | 3; id: string; text: string }[];
}

const nav = JSON.parse(fs.readFileSync(path.join(source, 'nav.json'), 'utf8')) as NavSection[];
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
  repository: { url: string };
};
const REPO = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: ' ' };

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|nbsp);/g, (_match, name: string) => entities[name] ?? _match)
    .replace(/\s+/g, ' ')
    .trim();

const slugify = (text: string): string =>
  stripTags(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ------------------------------------------------------------------------------------------
// Reading pages
// ------------------------------------------------------------------------------------------

function readPage(slug: string, section: string): Page {
  const file = path.join(source, 'content', `${slug}.html`);
  if (!fs.existsSync(file)) throw new Error(`nav.json lists "${slug}" but ${file} does not exist.`);
  const raw = fs.readFileSync(file, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (!match)
    throw new Error(`${slug}.html needs a front matter block (--- title / description ---).`);
  const meta: Record<string, string> = {};
  for (const line of (match[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (!meta.title || !meta.description)
    throw new Error(`${slug}.html needs a title and a description.`);
  return {
    slug,
    title: meta.title,
    description: meta.description,
    body: raw.slice(match[0].length),
    section,
    headings: [],
  };
}

const pages: Page[] = nav.flatMap((n) => n.pages.map((slug) => readPage(slug, n.section)));
const listed = new Set(pages.map((p) => p.slug));
for (const file of fs.readdirSync(path.join(source, 'content'))) {
  const slug = file.replace(/\.html$/, '');
  if (!listed.has(slug)) throw new Error(`docs/content/${file} is not listed in docs/nav.json.`);
}

// ------------------------------------------------------------------------------------------
// Shorthand elements
// ------------------------------------------------------------------------------------------

/** Width and height of a PNG, read from its header, so the page does not jump while it loads. */
function pngSize(file: string): { width: number; height: number } {
  const header = fs.readFileSync(file).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m?.[1];
}

const STATUS: Record<string, string> = {
  implemented: 'Implemented',
  partial: 'Partly implemented',
  limitation: 'Known limitation',
  unverified: 'Not verified',
  idea: 'Possible improvement',
};

const CALLOUT: Record<string, string> = {
  tip: 'Tip',
  note: 'Note',
  warning: 'Be careful',
  limit: 'Limitation',
};

const problems: string[] = [];

function expand(page: Page): string {
  let html = page.body;

  html = html.replace(
    /<shot\b([^>]*)>([\s\S]*?)<\/shot>/g,
    (_all, tag: string, caption: string) => {
      const name = attr(tag, 'name');
      const alt = attr(tag, 'alt');
      if (!name || !alt) throw new Error(`${page.slug}: <shot> needs name and alt.`);
      const file = path.join(source, 'assets', 'img', `${name}.png`);
      if (!fs.existsSync(file)) {
        problems.push(`${page.slug}: missing screenshot assets/img/${name}.png`);
        return '';
      }
      const { width, height } = pngSize(file);
      const src = `~/assets/img/${name}.png`;
      return `<figure class="shot"><a href="${src}"><img src="${src}" alt="${alt}" width="${width}" height="${height}" loading="lazy" decoding="async"></a><figcaption>${caption.trim()}</figcaption></figure>`;
    },
  );

  html = html.replace(
    /<clip\b([^>]*)>([\s\S]*?)<\/clip>/g,
    (_all, tag: string, caption: string) => {
      const name = attr(tag, 'name');
      const alt = attr(tag, 'alt');
      if (!name || !alt) throw new Error(`${page.slug}: <clip> needs name and alt.`);
      const file = path.join(source, 'assets', 'video', `${name}.webm`);
      const poster = path.join(source, 'assets', 'img', `${name}-poster.png`);
      if (!fs.existsSync(file)) {
        problems.push(`${page.slug}: missing recording assets/video/${name}.webm`);
        return '';
      }
      const size = fs.existsSync(poster) ? pngSize(poster) : { width: 1440, height: 900 };
      const src = `~/assets/video/${name}.webm`;
      return `<figure class="clip"><video controls preload="metadata" playsinline muted loop aria-label="${alt}" width="${size.width}" height="${size.height}"${fs.existsSync(poster) ? ` poster="~/assets/img/${name}-poster.png"` : ''}><source src="${src}" type="video/webm"><p>Your browser cannot play this recording. <a href="${src}">Download it</a>.</p></video><figcaption><strong>Recording.</strong> ${caption.trim()}</figcaption></figure>`;
    },
  );

  html = html.replace(/<status\b([^>]*?)\/?>(?:<\/status>)?/g, (_all, tag: string) => {
    const kind = attr(tag, 'kind') ?? '';
    const label = STATUS[kind];
    if (!label) throw new Error(`${page.slug}: unknown status "${kind}".`);
    return `<span class="status status-${kind}">${label}</span>`;
  });

  html = html.replace(
    /<callout\b([^>]*)>([\s\S]*?)<\/callout>/g,
    (_all, tag: string, inner: string) => {
      const type = attr(tag, 'type') ?? 'note';
      const title = attr(tag, 'title') ?? CALLOUT[type] ?? 'Note';
      return `<aside class="callout callout-${type}" role="note"><p class="callout-title">${title}</p>${inner.trim()}</aside>`;
    },
  );

  // Tables and code blocks that can scroll sideways must be reachable with the keyboard.
  html = html
    .replaceAll('<div class="table-wrap">', '<div class="table-wrap" tabindex="0">')
    .replaceAll('<pre>', '<pre tabindex="0">');

  // Headings get an id and a permalink; the table of contents is built from them.
  const used = new Set<string>();
  html = html.replace(
    /<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/g,
    (_all, level: string, rest: string, inner: string) => {
      let id = attr(rest, 'id') ?? slugify(inner);
      if (used.has(id)) id = `${id}-${used.size}`;
      used.add(id);
      page.headings.push({ level: Number(level) as 2 | 3, id, text: stripTags(inner) });
      return `<h${level} id="${id}">${inner}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${level}>`;
    },
  );

  return html;
}

// ------------------------------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------------------------------

/** `~/` means the docs folder; `up` is the way from this page to it ("" at the top, "../" below). */
function resolveLinks(html: string, up: string): string {
  const here = up === '' ? './' : up;
  return html.replace(/(href|src|poster)="~\/([^"]*)"/g, (_all, name: string, rest: string) => {
    return `${name}="${rest === '' ? here : `${up}${rest}`}"`;
  });
}

const pathOf = (slug: string): string => (slug === 'index' ? '' : `${slug}/`);

function navHtml(current: Page, up: string): string {
  return nav
    .map((group) => {
      const items = group.pages
        .map((slug) => {
          const page = pages.find((p) => p.slug === slug)!;
          const href = `${up}${pathOf(slug)}` || './';
          const here = slug === current.slug;
          const label = slug === 'index' ? 'Home' : page.title;
          return `<li><a href="${href}"${here ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a></li>`;
        })
        .join('');
      return `<section aria-labelledby="nav-${slugify(group.section)}"><h2 id="nav-${slugify(group.section)}">${escapeHtml(group.section)}</h2><ul>${items}</ul></section>`;
    })
    .join('');
}

function neighbours(current: Page, up: string): string {
  const i = pages.indexOf(current);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const link = (p: Page, label: string, cls: string) =>
    `<a class="${cls}" href="${up}${pathOf(p.slug) || (up === '' ? './' : '')}" rel="${cls}"><span>${label}</span>${escapeHtml(p.slug === 'index' ? 'Home' : p.title)}</a>`;
  return `<nav class="pager" aria-label="Previous and next page">${prev ? link(prev, 'Previous', 'prev') : '<span></span>'}${next ? link(next, 'Next', 'next') : ''}</nav>`;
}

function tocHtml(page: Page): string {
  if (page.headings.length < 3) return '';
  const items = page.headings
    .map((h) => `<li class="l${h.level}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`)
    .join('');
  return `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ol>${items}</ol></nav>`;
}

function render(page: Page): string {
  const depth = page.slug === 'index' ? 0 : 1;
  const up = '../'.repeat(depth);
  const body = expand(page);
  const appRoot = `${up}../`;
  const title = page.slug === 'index' ? 'Mossnote documentation' : `${page.title} · Mossnote docs`;
  const html = `<!doctype html>
<html lang="en" data-root="${up === '' ? './' : up}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${appRoot}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${up}assets/css/docs.css">
<script src="${up}assets/js/docs.js" defer></script>
</head>
<body>
<a class="skip" href="#content">Skip to the page</a>
<header class="top">
  <a class="brand" href="${up === '' ? './' : up}"><span class="mark" aria-hidden="true"></span>Mossnote <span class="brand-docs">docs</span></a>
  <form class="find" role="search" id="docs-find" hidden>
    <label class="sr" for="docs-find-input">Search the documentation</label>
    <input id="docs-find-input" type="search" placeholder="Search the docs" autocomplete="off">
    <ul id="docs-find-results" aria-label="Search results" hidden></ul>
  </form>
  <a class="open-app" href="${appRoot}">Open Mossnote</a>
</header>
<div class="shell">
  <details class="menu" id="docs-menu"><summary>Menu</summary>
    <nav class="side" aria-label="Documentation">${navHtml(page, up)}</nav>
  </details>
  <nav class="side side-wide" aria-label="Documentation">${navHtml(page, up)}</nav>
  <main id="content" tabindex="-1">
    <article>
      <p class="eyebrow">${escapeHtml(page.section)}</p>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="lede">${escapeHtml(page.description)}</p>
      ${tocHtml(page).replace('<nav class="toc"', '<nav class="toc toc-inline"')}
      ${body}
    </article>
    ${neighbours(page, up)}
    <footer class="foot">
      <p>These pages describe Mossnote ${escapeHtml(pkg.version)} and were checked against the source and the running app. Something wrong or missing? <a href="${REPO}/issues">Tell us on GitHub</a>.</p>
    </footer>
  </main>
  ${tocHtml(page)}
</div>
</body>
</html>
`;
  return resolveLinks(html, up);
}

// ------------------------------------------------------------------------------------------
// Output
// ------------------------------------------------------------------------------------------

function copyDir(from: string, to: string, skip: (name: string) => boolean = () => false): void {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip(entry.name)) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b, skip);
    else fs.copyFileSync(a, b);
  }
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const rendered = pages.map((page) => ({ page, html: render(page) }));
for (const { page, html } of rendered) {
  const dir = page.slug === 'index' ? out : path.join(out, page.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

copyDir(path.join(source, 'assets'), path.join(out, 'assets'), (name) => name.startsWith('.'));

// A small index for the search box: title, headings and the start of the text.
const index = rendered.map(({ page, html }) => ({
  t: page.title,
  u: pathOf(page.slug) || './',
  s: page.section,
  h: page.headings.map((h) => h.text),
  x: stripTags(html.slice(html.indexOf('<article>'), html.indexOf('</article>'))).slice(0, 1800),
}));
fs.writeFileSync(path.join(out, 'search-index.json'), JSON.stringify(index));

// Every address in the output must lead somewhere: a file, or a heading on a page.
const ids = new Map<string, Set<string>>();
for (const { page, html } of rendered) {
  const file = path.join(page.slug === 'index' ? out : path.join(out, page.slug), 'index.html');
  ids.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!)));
}
for (const { page, html } of rendered) {
  const dir = page.slug === 'index' ? out : path.join(out, page.slug);
  for (const match of html.matchAll(/\s(?:href|src|poster)="([^"]*)"/g)) {
    const target = (match[1] ?? '').replaceAll('&amp;', '&');
    if (/^(?:[a-z][a-z0-9+.-]*:|#?$)/i.test(target) && !target.startsWith('#')) continue;
    const [pathPart = '', hash] = target.split('#');
    let resolved = pathPart === '' ? path.join(dir, 'index.html') : path.resolve(dir, pathPart);
    if (
      pathPart.endsWith('/') ||
      (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())
    ) {
      resolved = path.join(resolved, 'index.html');
    }
    const leavesDocs = !resolved.startsWith(out);
    if (leavesDocs) continue; // the app itself, one folder up: not part of this build
    if (!fs.existsSync(resolved)) problems.push(`${page.slug}: broken address ${target}`);
    else if (hash && ids.has(resolved) && !ids.get(resolved)?.has(hash)) {
      problems.push(`${page.slug}: no heading #${hash} on ${path.relative(out, resolved)}`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`Documentation problems:\n${problems.map((p) => `  ${p}`).join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(
  `Documentation built: ${pages.length} pages in ${path.relative(root, out) || '.'}\n`,
);
