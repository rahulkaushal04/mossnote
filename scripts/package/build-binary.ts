import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';
import { build as bundle } from 'tsup';
import { pack, readFolder } from './archive';

/**
 * `npm run package:binary`: build the standalone download for the machine this runs on.
 *
 * The result is Node itself with the app inside it (Node's single executable support). The
 * native SQLite module cannot be cross-compiled, so each platform is built on its own system;
 * `.github/workflows/release.yml` does that for Windows and Linux. See decision 0006.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = path.join(root, 'build', 'package');
const releaseDir = path.join(root, 'release');
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
};

/** Things the running app never reads. Smaller is faster to unpack on a first start. */
export function isDeadWeight(relative: string): boolean {
  if (relative.startsWith('node_modules/.bin/') || relative === 'node_modules/.package-lock.json') {
    return true;
  }
  if (/^node_modules\/better-sqlite3\/(?:deps|src|docs)\//.test(relative)) return true;
  if (/^node_modules\/better-sqlite3\/build\/(?!Release\/better_sqlite3\.node$)/.test(relative)) {
    return true;
  }
  return /\.(?:map|d\.ts|d\.mts|d\.cts)$/.test(relative);
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

/** The app as it ships in the npm package, plus only the production dependencies. */
function stageApp(): string {
  const stage = path.join(work, 'app');
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const folder of ['dist', 'drizzle']) {
    fs.cpSync(path.join(root, folder), path.join(stage, folder), { recursive: true });
  }
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(root, file), path.join(stage, file));
  }
  run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], stage);
  return stage;
}

async function main(): Promise<void> {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) {
    throw new Error(
      `Build with Node 22.12 or newer (this is ${process.versions.node}): the program loads the app with require().`,
    );
  }
  for (const needed of ['dist/server/index.js', 'dist/web/index.html', 'drizzle']) {
    if (!fs.existsSync(path.join(root, needed))) {
      throw new Error(`${needed} is missing. Run "npm run build" first.`);
    }
  }

  process.stdout.write('Staging the app with its production dependencies…\n');
  const stage = stageApp();
  const files = readFolder(stage, isDeadWeight);
  const archive = pack(files);
  const archivePath = path.join(work, 'app.bin');
  fs.writeFileSync(archivePath, archive);
  fs.writeFileSync(path.join(work, 'version.txt'), pkg.version);
  process.stdout.write(
    `Packed ${files.length} files into ${(archive.length / 1024 / 1024).toFixed(1)} MB.\n`,
  );

  await bundle({
    entry: { launcher: path.join(root, 'scripts', 'package', 'launcher.ts') },
    outDir: work,
    format: ['cjs'],
    platform: 'node',
    target: 'node22',
    noExternal: [/.*/],
    config: false,
    clean: false,
    silent: true,
    tsconfig: path.join(root, 'tsconfig.tools.json'),
  });

  const blobPath = path.join(work, 'sea-prep.blob');
  const seaConfig = path.join(work, 'sea-config.json');
  fs.writeFileSync(
    seaConfig,
    JSON.stringify({
      main: path.join(work, 'launcher.cjs'),
      output: blobPath,
      disableExperimentalSEAWarning: true,
      useCodeCache: false,
      assets: { app: archivePath, version: path.join(work, 'version.txt') },
    }),
  );
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

  const names: Partial<Record<NodeJS.Platform, string>> = {
    win32: 'win',
    darwin: 'macos',
    linux: 'linux',
  };
  const platform = names[process.platform] ?? process.platform;
  const target = `${platform}-${process.arch}`;
  const exeName = process.platform === 'win32' ? 'mossnote.exe' : 'mossnote';
  const exe = path.join(work, exeName);
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
  if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(blobPath), {
    sentinelFuse: SENTINEL,
    ...(process.platform === 'darwin' ? { machoSegmentName: 'NODE_SEA' } : {}),
  });
  if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);

  fs.mkdirSync(releaseDir, { recursive: true });
  const base = `mossnote-v${pkg.version}-${target}`;
  let output: string;
  if (process.platform === 'win32') {
    output = path.join(releaseDir, `${base}.exe`);
    fs.copyFileSync(exe, output);
  } else {
    // A tarball keeps the "runnable" bit that a plain download would lose.
    output = path.join(releaseDir, `${base}.tar.gz`);
    run('tar', ['-czf', output, '-C', work, exeName], root);
  }
  const sum = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
  fs.writeFileSync(`${output}.sha256`, `${sum}  ${path.basename(output)}\n`);
  process.stdout.write(`\nBuilt ${output}\nSHA-256 ${sum}\n`);
  if (platform === 'macos') {
    process.stdout.write(
      'This is a macOS build for checking the pipeline only. It is not released.\n',
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
