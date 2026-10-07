#!/usr/bin/env node
// `mossnote` / `npx mossnote`: start the server from the built app and open the browser.
// Plain JavaScript on purpose: this file runs straight from the installed package, before
// anything has been compiled, and must say something useful on an unsupported Node.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));

const HELP = `Mossnote ${pkg.version}
A private journal for the games you play. It runs on this computer only.

Usage: mossnote [options]

Options:
  --port <number>      Port to listen on (default 4317; MOSS_PORT)
  --data-dir <folder>  Where journals are kept (MOSS_DATA_DIR)
  --journal <name>     Open this journal's file name at start (MOSS_JOURNAL)
  --no-open            Do not open the browser (MOSS_OPEN_BROWSER=0)
  --version, -v        Print the version
  --help, -h           Print this help

Your journals live in your user folder, never beside the program, so installing,
upgrading or reinstalling Mossnote never touches them. See the README for the paths.`;

const args = process.argv.slice(2);
const take = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    process.stderr.write(`${flag} needs a value. Run mossnote --help.\n`);
    process.exit(1);
  }
  return value;
};

if (args.includes('--version') || args.includes('-v')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  process.stderr.write(
    `Mossnote needs Node 22.12 or newer. This is Node ${process.versions.node}.\n` +
      'Get a newer Node from nodejs.org, or use the Mossnote download that includes its own.\n',
  );
  process.exit(1);
}

const server = fileURLToPath(new URL('dist/server/index.js', root));
if (!fs.existsSync(server)) {
  process.stderr.write(
    'This copy of Mossnote has not been built yet. Run "npm run build" in its folder, or use "npm start".\n',
  );
  process.exit(1);
}

process.env.NODE_ENV ??= 'production';
process.env.npm_package_version = pkg.version;
const port = take('--port');
if (port !== undefined) process.env.MOSS_PORT = port;
const dataDir = take('--data-dir');
if (dataDir !== undefined) process.env.MOSS_DATA_DIR = dataDir;
const journal = take('--journal');
if (journal !== undefined) process.env.MOSS_JOURNAL = journal;
if (args.includes('--no-open')) process.env.MOSS_OPEN_BROWSER = '0';

await import('../dist/server/index.js');
