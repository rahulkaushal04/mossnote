import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run check:pages`: checks a built web version (`dist/standalone`) for the way a static host
 * serves it. A project site lives under `/<repository>/`, so one address written as `/assets/x.js`
 * instead of `/<repository>/assets/x.js` works on a developer's machine and 404s once published.
 * This reads the build, not a running site, so it runs anywhere and needs no browser.
 *
 *   npm run check:pages                  the base path the build was made for, read from its manifest
 *   npm run check:pages -- /mossnote/    fail unless the build was made for that base path
 */

export interface Problem {
  file: string;
  message: string;
}

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** `/mossnote/` for `mossnote`, `/` for nothing: the form `vite.config.ts` gives the build. */
export function normalizeBase(base: string): string {
  return `${base.startsWith('/') ? '' : '/'}${base}${base.endsWith('/') ? '' : '/'}`;
}

/** Where the build says it is served: the manifest's scope, which `vite.config.ts` sets from MOSS_BASE. */
export function builtBase(dist: string): string | null {
  const file = path.join(dist, 'manifest.webmanifest');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(read(file)) as { scope?: unknown };
  return typeof manifest.scope === 'string' ? manifest.scope : null;
}

/** Root-relative addresses (`/x`, not `//x` and not `/mossnote/x`) written in `attribute="…"` form. */
function strayAddresses(text: string, base: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\b(?:href|src|poster|content)=["'](\/[^"']*)["']/g)) {
    const address = match[1] ?? '';
    if (address.startsWith('//')) continue;
    if (!address.startsWith(base)) found.push(address);
  }
  for (const match of text.matchAll(/url\(\s*["']?(\/[^)"'\s]*)/g)) {
    const address = match[1] ?? '';
    if (!address.startsWith('//') && !address.startsWith(base)) found.push(address);
  }
  return found;
}

function* files(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else yield full;
  }
}

/** Everything wrong with the build in `dist` for a site served at `base`. Empty when it is fit to publish. */
export function checkSite(dist: string, expected?: string): Problem[] {
  const problems: Problem[] = [];
  const add = (file: string, message: string) => problems.push({ file, message });

  const built = builtBase(dist);
  if (built === null) {
    add('manifest.webmanifest', 'is missing, so the build is not the web version.');
    return problems;
  }
  const base = normalizeBase(expected ?? built);
  if (built !== base) {
    add(
      'manifest.webmanifest',
      `says the site is served at "${built}" but it is meant for "${base}". Build with MOSS_BASE=${base}.`,
    );
    // Everything else would only repeat the same mistake.
    return problems;
  }

  // The page, and the copy a static host serves for an address it does not know.
  const indexFile = path.join(dist, 'index.html');
  const notFoundFile = path.join(dist, '404.html');
  if (!fs.existsSync(indexFile)) add('index.html', 'is missing.');
  if (!fs.existsSync(notFoundFile)) {
    add('404.html', 'is missing, so a refresh on any page but the first would show GitHub 404.');
  } else if (fs.existsSync(indexFile) && read(notFoundFile) !== read(indexFile)) {
    add(
      '404.html',
      'is not a copy of index.html, so a refresh on a deep link would not open the app.',
    );
  }

  // Every address in the page, the manifest and the stylesheets stays under the base path.
  for (const file of files(dist)) {
    const relative = path.relative(dist, file).split(path.sep).join('/');
    if (relative.startsWith('docs/')) continue;
    if (!/\.(?:html|css|webmanifest)$/.test(relative)) continue;
    const text = read(file);
    for (const address of strayAddresses(text, base)) {
      add(relative, `uses "${address}", which is outside "${base}".`);
    }
    if (relative.endsWith('.webmanifest')) {
      const manifest = JSON.parse(text) as {
        start_url?: string;
        scope?: string;
        icons?: { src: string }[];
      };
      for (const address of [
        manifest.start_url,
        manifest.scope,
        ...(manifest.icons ?? []).map((i) => i.src),
      ]) {
        if (typeof address === 'string' && !address.startsWith(base)) {
          add(relative, `uses "${address}", which is outside "${base}".`);
        }
      }
    }
  }

  // The service worker keeps these for offline use: each must exist, or its install fails and
  // the app never works offline.
  const workerFile = path.join(dist, 'sw.js');
  if (!fs.existsSync(workerFile)) {
    add('sw.js', 'is missing, so the web version would not work offline.');
  } else {
    const source = read(workerFile);
    const list = /JSON\.parse\('(.*)'\)/.exec(source);
    if (!list) {
      add('sw.js', 'has no list of files to keep.');
    } else {
      const kept = JSON.parse(
        (list[1] ?? '').replaceAll("\\'", "'").replaceAll('\\\\', '\\'),
      ) as string[];
      if (!kept.includes(`${base}index.html`) && !kept.includes(base)) {
        add('sw.js', 'does not keep the app page.');
      }
      for (const address of kept) {
        if (!address.startsWith(base)) {
          add('sw.js', `keeps "${address}", which is outside "${base}".`);
          continue;
        }
        const relative = address.slice(base.length);
        if (relative !== '' && !fs.existsSync(path.join(dist, relative))) {
          add('sw.js', `keeps "${address}", but dist/standalone/${relative} does not exist.`);
        }
      }
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const dist = path.join(root, 'dist', 'standalone');
  const [, , argument] = process.argv;
  const expected =
    argument === undefined || argument === '--' ? undefined : normalizeBase(argument);
  if (!fs.existsSync(dist)) {
    process.stderr.write('dist/standalone is missing. Run "npm run build:standalone" first.\n');
    process.exit(1);
  }
  const problems = checkSite(dist, expected);
  if (problems.length > 0) {
    process.stderr.write('The web version is not ready to publish:\n');
    for (const problem of problems) process.stderr.write(`  ${problem.file}: ${problem.message}\n`);
    process.exit(1);
  }
  process.stdout.write(`The web version is fit for a site served at ${builtBase(dist) ?? '/'}.\n`);
}
