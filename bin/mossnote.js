#!/usr/bin/env node
// `mossnote` / `npx mossnote`: start the server from the built app and open the browser.
// Plain JavaScript on purpose: this file runs straight from the installed package, before
// anything has been compiled, and must say something useful on an unsupported Node.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MIN_NODE, helpText, nodeIsSupported, parseArgs, UsageError } from './options.js';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(new URL('package.json', root), 'utf8'));

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}

if (options.help) {
  process.stdout.write(`${helpText(pkg.version)}\n`);
  process.exit(0);
}
if (options.version) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (!nodeIsSupported(process.versions.node)) {
  process.stderr.write(
    `Mossnote needs Node ${MIN_NODE.major}.${MIN_NODE.minor} or newer. This is Node ${process.versions.node}.\n` +
      'Get a newer Node from https://nodejs.org.\n' +
      'More help: https://rahulkaushal04.github.io/mossnote/docs/troubleshooting/\n',
  );
  process.exit(1);
}

const server = fileURLToPath(new URL('dist/server/index.js', root));
if (!fs.existsSync(server)) {
  process.stderr.write(
    'This copy of Mossnote has not been built yet. Run "npm run build" in its folder, or use "npm start".\n' +
      'More help: https://rahulkaushal04.github.io/mossnote/docs/troubleshooting/\n',
  );
  process.exit(1);
}

// An installed copy is never a development build. A NODE_ENV=development left in the shell would
// otherwise stop the server from serving the app at all.
process.env.NODE_ENV = 'production';
Object.assign(process.env, options.env);

await import('../dist/server/index.js');
