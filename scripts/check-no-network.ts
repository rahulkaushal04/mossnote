import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Static no-network check: scans source and the built web app for URLs
 * that could reach beyond localhost. The runtime guarantee is the end-to-end test that blocks
 * every non-localhost request; this catches a CDN link, remote font or analytics snippet
 * before it ever runs.
 */

/** Hosts that are never requests, anywhere: XML namespaces and loopback. */
const SOURCE_HOSTS = new Set(['www.w3.org', 'localhost', '127.0.0.1']);

/**
 * Extra hosts allowed only inside the built output: text that libraries ship as messages or
 * licence banners (React and React Router error links, the Tailwind banner). They are strings,
 * never fetched; the end-to-end test is what proves no request leaves the machine.
 */
export const BUILT_HOSTS = new Set([
  ...SOURCE_HOSTS,
  'react.dev',
  'reactjs.org',
  'reactrouter.com',
  'github.com',
  'tailwindcss.com',
  // zod ships a JSON Schema generator whose error message names this host; it is never fetched.
  'json-schema.org',
]);

/**
 * The one source file that may name a web page: links the person clicks to open in their own
 * browser (see `src/shared/links.ts`). Nothing in the app ever fetches them.
 */
const LINK_FILE = path.join('src', 'shared', 'links.ts');
const LINK_HOSTS = new Set([...SOURCE_HOSTS, 'github.com']);

const URL_PATTERN =
  /(?<![\w/.:-])(?:https?:)?\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,}|localhost|127\.0\.0\.1)(?::\d+)?(?:[/"'`)\s]|$)/gi;
const REMOTE_IMPORT =
  /(?:@import\s+(?:url\()?\s*['"]?https?:|src\s*=\s*["']https?:|href\s*=\s*["']https?:)/i;

export interface Finding {
  file: string;
  line: number;
  host: string;
  text: string;
}

/** Find URL hosts in `text` that are not allowed. Comments about licences and docs are skipped. */
export function findExternalUrls(
  file: string,
  text: string,
  allowed: ReadonlySet<string> = SOURCE_HOSTS,
): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (REMOTE_IMPORT.test(line)) {
      findings.push({
        file,
        line: index + 1,
        host: 'remote resource',
        text: line.trim().slice(0, 120),
      });
      return;
    }
    for (const match of line.matchAll(URL_PATTERN)) {
      const host = (match[1] ?? '').toLowerCase();
      if (!allowed.has(host)) {
        findings.push({ file, line: index + 1, host, text: line.trim().slice(0, 120) });
      }
    }
  });
  return findings;
}

const SCANNED = /\.(?:ts|tsx|js|mjs|css|html|json|svg)$/;

function* walk(dir: string): Generator<string> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (SCANNED.test(entry.name)) yield full;
  }
}

export function scan(root: string, dirs: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const dir of dirs) {
    const allowed = dir.startsWith('dist') ? BUILT_HOSTS : SOURCE_HOSTS;
    for (const file of walk(path.join(root, dir))) {
      // Tests assert on hostile URLs on purpose; they never ship.
      if (/\.test\.tsx?$/.test(file) || file.includes(`${path.sep}testing${path.sep}`)) continue;
      const relative = path.relative(root, file);
      findings.push(
        ...findExternalUrls(
          relative,
          fs.readFileSync(file, 'utf8'),
          relative === LINK_FILE ? LINK_HOSTS : allowed,
        ),
      );
    }
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const findings = scan(root, ['src', 'dist/web', 'dist/server']);
  if (findings.length > 0) {
    process.stderr.write('External URLs found. Mossnote must not reach the network:\n');
    for (const f of findings) process.stderr.write(`  ${f.file}:${f.line}  ${f.host}  ${f.text}\n`);
    process.exit(1);
  }
  process.stdout.write('No external URLs in src/ or dist/.\n');
}
