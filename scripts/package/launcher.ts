// The program that becomes the standalone Windows and Linux downloads. It is compiled to one
// CommonJS file (Node's single executable support loads CommonJS) and carries the whole app as an
// embedded asset. On start it makes sure a copy of the app is unpacked in the user's cache folder,
// then runs the same server that `mossnote` and `npm start` run. Journals are not part of it:
// they live in the user's data folder, as always.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as NodeSea from 'node:sea';
import envPaths from 'env-paths';
import { archiveId, ensureUnpacked, pruneOthers } from './runtime';

// `node:sea` only exists inside a single executable. The name is assembled at run time so the
// bundler keeps the `node:` prefix instead of rewriting it to a module that does not exist.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sea = require(['node', 'sea'].join(':')) as typeof NodeSea;

const asBuffer = (key: string): Buffer => Buffer.from(sea.getRawAsset(key));

const HELP = (version: string) => `Mossnote ${version}
A private journal for the games you play. It runs on this computer only.

Usage: mossnote [--port <number>] [--data-dir <folder>] [--journal <name>] [--no-open]
       mossnote --version

Close this window, or press Ctrl+C, to stop Mossnote. Your journals are kept in your user
folder, not next to this file, so replacing this file with a newer one never touches them.`;

function main(): void {
  const version = asBuffer('version').toString('utf8');
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP(version)}\n`);
    return;
  }

  const flags: Record<string, string> = {
    '--port': 'MOSS_PORT',
    '--data-dir': 'MOSS_DATA_DIR',
    '--journal': 'MOSS_JOURNAL',
  };
  for (const [flag, variable] of Object.entries(flags)) {
    const at = args.indexOf(flag);
    if (at === -1) continue;
    const value = args[at + 1];
    if (value === undefined || value.startsWith('--')) {
      process.stderr.write(`${flag} needs a value. Run mossnote --help.\n`);
      process.exit(1);
    }
    process.env[variable] = value;
  }
  if (args.includes('--no-open')) process.env.MOSS_OPEN_BROWSER = '0';

  const archive = asBuffer('app');
  const id = archiveId(version, archive);
  // The cache holds code only; it is not where journals live.
  const root = path.join(envPaths('Mossnote', { suffix: '' }).cache, 'app');
  if (!fs.existsSync(path.join(root, id, '.ready'))) {
    process.stdout.write(`Mossnote ${version}: unpacking for the first run…\n`);
  }
  const appDir = ensureUnpacked({ archive, root, id });
  pruneOthers(root, id);

  process.env.NODE_ENV ??= 'production';
  process.env.npm_package_version = version;
  // A single executable can only `require` built-in modules itself; this reaches the unpacked app.
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  appRequire(path.join(appDir, 'dist', 'server', 'index.js'));
}

main();
