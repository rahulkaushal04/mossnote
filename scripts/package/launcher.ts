// The standalone program: unpacks the embedded app into the cache folder, then runs the server.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type * as NodeSea from 'node:sea';
import envPaths from 'env-paths';
import { helpText, parseArgs, UsageError } from '../../bin/options.js';
import { archiveId, ensureUnpacked, pruneOthers } from './runtime';

// `node:sea` only exists in a single executable; the name is built at run time so the bundler keeps it.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sea = require(['node', 'sea'].join(':')) as typeof NodeSea;

const asBuffer = (key: string): Buffer => Buffer.from(sea.getRawAsset(key));

function main(): void {
  const version = asBuffer('version').toString('utf8');
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  if (options.help) {
    process.stdout.write(`${helpText(version, { program: true })}\n`);
    return;
  }
  if (options.version) {
    process.stdout.write(`${version}\n`);
    return;
  }

  const archive = asBuffer('app');
  const id = archiveId(version, archive);
  const root = path.join(envPaths('Mossnote', { suffix: '' }).cache, 'app');
  if (!fs.existsSync(path.join(root, id, '.ready'))) {
    process.stdout.write(`Mossnote ${version}: unpacking for the first run…\n`);
  }
  let appDir: string;
  try {
    appDir = ensureUnpacked({ archive, root, id });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Mossnote could not unpack itself into ${root}: ${reason}\n` +
        'It needs about 60 MB there. Free some space or fix the permissions, or point the cache\n' +
        'somewhere you can write to (XDG_CACHE_HOME on Linux, LOCALAPPDATA on Windows).\n',
    );
    process.exit(1);
  }
  pruneOthers(root, id);

  process.env.NODE_ENV = 'production';
  Object.assign(process.env, options.env);
  const appRequire = createRequire(path.join(appDir, 'package.json'));
  appRequire(path.join(appDir, 'dist', 'server', 'index.js'));
}

main();
