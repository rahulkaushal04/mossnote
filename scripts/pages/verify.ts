import { spawnSync } from 'node:child_process';
import { normalizeBase } from './check-site';

/**
 * `npm run verify:pages`: builds the web version for a GitHub project site and checks it the way
 * the published site will be served, without publishing anything.
 *
 *   npm run verify:pages                   base path /mossnote/
 *   npm run verify:pages -- /my-fork/      another repository name
 *   npm run verify:pages -- / --webkit     a root site; also run the WebKit tests
 *
 * It needs Playwright's browsers (`npx playwright install chromium`, plus `webkit` for --webkit).
 * Uses the same steps, in the same order, as `.github/workflows/pages.yml`.
 */
const args = process.argv.slice(2);
const webkit = args.includes('--webkit');
const base = normalizeBase(args.find((arg) => !arg.startsWith('--')) ?? '/mossnote/');

const env = { ...process.env, MOSS_BASE: base, MOSS_EXPECT_BASE: base };

function step(title: string, command: string, commandArgs: string[]): void {
  process.stdout.write(`\n== ${title}\n`);
  const result = spawnSync(command, commandArgs, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.stderr.write(`\n"${title}" failed. The web version is not ready to publish.\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(`Verifying the web version for a site served at ${base}\n`);
step('Build the web version', 'npm', ['run', 'build:standalone']);
// The documentation is added after the outbound-URL check, as in the workflow: it links to
// GitHub pages the reader may click.
step('Check for outbound URLs', 'npm', ['run', 'check:network']);
step('Build the documentation into the site', 'npm', ['run', 'docs:build']);
step('Check addresses, 404.html and the offline file list', 'npm', [
  'run',
  'check:pages',
  '--',
  base,
]);
const projects = ['--project=pages', ...(webkit ? ['--project=pages-webkit'] : [])];
step('Open it the way GitHub Pages serves it', 'npx', ['playwright', 'test', ...projects]);
process.stdout.write(`\nThe web version is ready to publish at ${base}.\n`);
