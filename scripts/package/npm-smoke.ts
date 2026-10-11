import fs from 'node:fs';
import { builtinModules } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import {
  check,
  isWindows,
  isolatedEnvironment,
  passedChecks,
  run,
  runtimeChecks,
  sleep,
  snapshotFolder,
  step,
  type Server,
} from './runtime-checks';

/**
 * `npm run package:npm-smoke`: the npm package as a stranger gets it. Builds the tarball (`npm
 * pack`), checks what is in it, installs it into an empty project and into a global prefix, runs
 * `mossnote` every way a person can, and checks that it serves the app, keeps journals in the
 * user's data folder (and nowhere else), stops cleanly and reports mistakes in plain words.
 *
 * Nothing here reads the repository's source: after the tarball is made, everything runs from the
 * installed copy, in a throwaway home folder and a throwaway working folder. It runs on Linux,
 * macOS and Windows with whatever Node is first on the PATH, which is the point: CI runs it for
 * each system and each supported Node.
 *
 *   npm run package:npm-smoke                         pack, then test
 *   npm run package:npm-smoke -- --tarball x.tgz      test a tarball that is already made
 *   PACKAGE_TARBALL=x.tgz npm run package:npm-smoke   the same, for shells that drop the `--`
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackageJson {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  scripts?: Record<string, string>;
  engines?: { node?: string };
}

const repoPackage = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
) as PackageJson;

/** `npm` is a script on every system, and a `.cmd` file on Windows, which needs a shell. */
const npm = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  run('npm', args, { ...options, shell: isWindows });

// ------------------------------------------------------------------------------------------

interface PackedFile {
  path: string;
  size: number;
  mode: number;
}

function pack(into: string): string {
  const result = npm(['pack', '--json', '--pack-destination', into], { cwd: root });
  check(result.status === 0, `npm pack failed:\n${result.all}`);
  // `prepack` prints the build's output before the JSON, so take the last JSON array.
  const start = result.stdout.lastIndexOf('\n[');
  const parsed = JSON.parse(result.stdout.slice(start === -1 ? 0 : start)) as {
    filename: string;
  }[];
  const [entry] = parsed;
  check(entry, 'npm pack described no tarball');
  return path.join(into, entry.filename);
}

/**
 * The files of a `.tgz`, read with Node alone so that the check runs the same on every system
 * (the `tar` on a Windows machine may be GNU's, which reads `C:\` as a host name). Each file's
 * path has the leading `package/` removed. Only regular files are returned.
 */
function readTarball(tarball: string): { files: PackedFile[]; read: (name: string) => Buffer } {
  const raw = zlib.gunzipSync(fs.readFileSync(tarball));
  const files: PackedFile[] = [];
  const contents = new Map<string, Buffer>();
  const text = (start: number, length: number) =>
    raw
      .subarray(start, start + length)
      .toString('utf8')
      .replace(/\0.*$/s, '');
  let offset = 0;
  let longPath: string | undefined;
  while (offset + 512 <= raw.length && raw[offset] !== 0) {
    const size = Number.parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = text(offset + 156, 1) || '0';
    const body = raw.subarray(offset + 512, offset + 512 + size);
    if (type === 'x') {
      // A pax header: "<length> path=<name>\n" records that apply to the next entry.
      const match = /\d+ path=([^\n]+)\n/.exec(body.toString('utf8'));
      longPath = match?.[1];
    } else if (type === 'g') {
      // Global pax header: nothing to use.
    } else if (type === '0') {
      const prefix = text(offset + 345, 155);
      const name =
        longPath ?? (prefix === '' ? text(offset, 100) : `${prefix}/${text(offset, 100)}`);
      longPath = undefined;
      check(
        name.startsWith('package/'),
        `every file in the tarball is under package/ (found ${name})`,
      );
      const relative = name.slice('package/'.length);
      files.push({
        path: relative,
        size,
        mode: Number.parseInt(text(offset + 100, 8).trim() || '0', 8),
      });
      contents.set(relative, Buffer.from(body));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return {
    files,
    read(name) {
      const found = contents.get(name);
      check(found, `the tarball holds ${name}`);
      return found;
    },
  };
}

/** `--tarball` names a `.tgz`, or a folder that holds exactly one. */
function findTarball(argument: string | undefined): string {
  check(argument, '--tarball needs a file or a folder');
  const target = path.resolve(argument);
  check(fs.existsSync(target), `${target} exists`);
  if (!fs.statSync(target).isDirectory()) return target;
  const found = fs.readdirSync(target).filter((name) => name.endsWith('.tgz'));
  check(found.length === 1, `${target} holds exactly one .tgz (found ${found.length})`);
  return path.join(target, found[0]!);
}

const REQUIRED = [
  'package.json',
  'LICENSE',
  'README.md',
  'bin/mossnote.js',
  'bin/options.js',
  'dist/server/index.js',
  'dist/web/index.html',
  'drizzle/meta/_journal.json',
];
const ALLOWED = /^(?:package\.json|LICENSE|README\.md|bin\/|dist\/server\/|dist\/web\/|drizzle\/)/;
const FORBIDDEN =
  /(?:\.map$|_snapshot\.json$|\.env|(?:^|\/)(?:src|tests?|scripts|docs|\.github|node_modules|local_reference|dist\/standalone)\/|\.test\.|\.tsbuildinfo$)/;
/** Installed only for development: none of these may be needed, or installed, by a person using Mossnote. */
const DEV_ONLY = [
  'vite',
  'typescript',
  'react',
  'react-dom',
  'tsx',
  'vitest',
  'eslint',
  '@playwright/test',
  'tsup',
];

function checkTarball(files: PackedFile[], packageJson: PackageJson, modesAreReal: boolean): void {
  const names = files.map((file) => file.path);
  for (const required of REQUIRED) check(names.includes(required), `the tarball has ${required}`);
  check(
    names.some((name) => /^drizzle\/\d{4}_.+\.sql$/.test(name)),
    'the tarball has the SQL migrations',
  );
  check(
    names.some((name) => /^dist\/web\/assets\/.+\.js$/.test(name)),
    'the tarball has the built web app',
  );
  const stray = names.filter((name) => !ALLOWED.test(name));
  check(
    stray.length === 0,
    `nothing outside the intended folders is packed (found ${stray.join(', ')})`,
  );
  const forbidden = names.filter((name) => FORBIDDEN.test(name));
  check(
    forbidden.length === 0,
    `no source, tests, maps, env files or snapshots are packed (found ${forbidden.join(', ')})`,
  );

  const bin = files.find((file) => file.path === 'bin/mossnote.js');
  if (modesAreReal) {
    check(bin && (bin.mode & 0o111) !== 0, 'bin/mossnote.js is marked executable in the tarball');
  }
  const total = files.reduce((sum, file) => sum + file.size, 0);
  check(
    total < 5 * 1024 * 1024,
    `the package is small (${(total / 1024 / 1024).toFixed(1)} MB unpacked)`,
  );

  // Scripts named like these run on the machine of everyone who installs the package.
  const scripts = Object.keys(packageJson.scripts ?? {});
  const lifecycle = scripts.filter((name) => /^(?:pre|post)?install$|^prepare$/.test(name));
  check(
    lifecycle.length === 0,
    `the package runs nothing when installed (found ${lifecycle.join(', ')})`,
  );
  check(
    packageJson.version === repoPackage.version,
    'the packed version is the repository version',
  );
  check(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version),
    `the version ${packageJson.version} is a semantic version`,
  );
  check(Boolean(packageJson.engines?.node), 'the package states which Node it needs');
}

/** Every package the built server imports must be one it declares as a dependency. */
function checkImports(installed: string, packageJson: PackageJson): void {
  const source = fs.readFileSync(path.join(installed, 'dist', 'server', 'index.js'), 'utf8');
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/^(?:import|export)\s[^'"\n]*?from\s*['"]([^'"]+)['"]/gm)) {
    if (match[1]) specifiers.add(match[1]);
  }
  for (const match of source.matchAll(/^import\s*['"]([^'"]+)['"]/gm)) {
    if (match[1]) specifiers.add(match[1]);
  }
  check(specifiers.size > 5, 'the built server imports its dependencies');
  const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
  for (const specifier of specifiers) {
    if (specifier.startsWith('.') || builtins.has(specifier)) continue;
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
    check(
      name in packageJson.dependencies,
      `the built server's import "${specifier}" is a declared dependency`,
    );
  }
}

// ------------------------------------------------------------------------------------------
// Installing
// ------------------------------------------------------------------------------------------

function platformKey(): string {
  const system = process.platform === 'linux' ? 'linux' : process.platform;
  return `${system}-${process.arch}`;
}

function checkInstall(project: string): string {
  const installed = path.join(project, 'node_modules', 'mossnote');
  check(fs.existsSync(path.join(installed, 'package.json')), 'the package is installed');

  const listing = npm(['ls', '--omit=dev', '--all', '--json'], { cwd: project });
  check(listing.status === 0, `npm reports a consistent dependency tree:\n${listing.all}`);
  for (const name of DEV_ONLY) {
    check(
      !fs.existsSync(path.join(project, 'node_modules', name)),
      `${name} is not installed for a person using Mossnote`,
    );
  }

  // The SQLite module ships a prebuilt file for each system: nothing is compiled on install.
  const prebuilt = path.join(
    project,
    'node_modules',
    'better-sqlite3',
    'prebuilds',
    `${platformKey()}.node`,
  );
  const hasMusl =
    process.platform === 'linux' &&
    fs.existsSync(path.join(path.dirname(prebuilt), `linuxmusl-${process.arch}.node`));
  check(
    fs.existsSync(prebuilt) || hasMusl,
    `better-sqlite3 has a prebuilt module for ${platformKey()}`,
  );
  check(
    !fs.existsSync(path.join(project, 'node_modules', 'better-sqlite3', 'build')),
    'better-sqlite3 was not compiled on install',
  );
  const probe = run(
    process.execPath,
    [
      '-e',
      `const R=require('module').createRequire(process.argv[1]);const D=R('better-sqlite3');const db=new D(':memory:');` +
        `db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');db.exec("INSERT INTO t VALUES ('lantern')");` +
        `if(db.prepare("SELECT count(*) c FROM t WHERE t MATCH 'lantern'").get().c!==1)process.exit(3);` +
        `console.log('sqlite '+db.prepare('select sqlite_version() v').get().v+' fts5 ok')`,
      path.join(installed, 'package.json'),
    ],
    { cwd: project },
  );
  check(
    probe.status === 0 && probe.stdout.includes('fts5 ok'),
    `the native SQLite module loads and has full-text search:\n${probe.all}`,
  );
  process.stdout.write(`   ${probe.stdout.trim()}\n`);
  return installed;
}

// ------------------------------------------------------------------------------------------
// Running it
// ------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-npm-smoke-'));
  const live: Server[] = [];
  try {
    const given = process.argv.indexOf('--tarball');
    const wanted = given === -1 ? process.env.PACKAGE_TARBALL : process.argv[given + 1];
    const useBuilt = given !== -1 || Boolean(process.env.PACKAGE_TARBALL);

    step(useBuilt ? 'Use the tarball that was built earlier' : 'Build the tarball');
    const tarball = useBuilt ? findTarball(wanted) : pack(base);
    check(fs.existsSync(tarball), `the tarball exists: ${path.basename(tarball)}`);
    process.stdout.write(
      `   ${path.basename(tarball)} on Node ${process.versions.node}, ${platformKey()}\n`,
    );

    step('Check what is in the tarball');
    const { files, read } = readTarball(tarball);
    const packedJson = JSON.parse(read('package.json').toString('utf8')) as PackageJson;
    checkTarball(files, packedJson, !isWindows || useBuilt);
    process.stdout.write(`   ${files.length} files, version ${packedJson.version}\n`);

    step('Install it into an empty project');
    const project = path.join(base, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'moss-smoke', private: true }),
    );
    const cache = path.join(base, 'npm-cache');
    const install = npm(['install', tarball, '--no-audit', '--no-fund', '--cache', cache], {
      cwd: project,
    });
    check(install.status === 0, `npm install succeeds:\n${install.all}`);
    check(
      !install.all.includes('EBADENGINE'),
      `npm does not warn about the Node version:\n${install.all}`,
    );
    const installed = checkInstall(project);
    checkImports(installed, packedJson);
    const installedBefore = snapshotFolder(installed);

    step('Install it globally into a throwaway prefix');
    const prefix = path.join(base, 'global');
    const globalInstall = npm([
      'install',
      '-g',
      tarball,
      '--prefix',
      prefix,
      '--no-audit',
      '--no-fund',
      '--cache',
      cache,
    ]);
    check(globalInstall.status === 0, `npm install -g succeeds:\n${globalInstall.all}`);
    const globalCommand = isWindows
      ? path.join(prefix, 'mossnote.cmd')
      : path.join(prefix, 'bin', 'mossnote');
    check(fs.existsSync(globalCommand), 'the global install creates the mossnote command');

    const { cwd, env, defaultDataDir } = isolatedEnvironment(path.join(base, 'user'));
    const shim = path.join(
      project,
      'node_modules',
      '.bin',
      isWindows ? 'mossnote.cmd' : 'mossnote',
    );
    const binFile = path.join(installed, 'bin', 'mossnote.js');

    step('Every way to run it reports its version and help');
    const version = packedJson.version;
    const ways: { name: string; command: string; args: string[]; shell?: boolean; cwd?: string }[] =
      [
        { name: 'node bin/mossnote.js', command: process.execPath, args: [binFile] },
        { name: 'the .bin shim', command: shim, args: [], shell: isWindows },
        { name: 'the global command', command: globalCommand, args: [], shell: isWindows },
        {
          name: 'npx --no-install',
          command: 'npx',
          args: ['--no-install', 'mossnote'],
          shell: isWindows,
          cwd: project,
        },
        {
          name: 'npm exec from the tarball (what npx does for a package that is not installed)',
          command: 'npm',
          args: ['exec', '--yes', '--cache', cache, `--package=${tarball}`, '--', 'mossnote'],
          shell: isWindows,
          cwd: cwd,
        },
      ];
    for (const way of ways) {
      const out = run(way.command, [...way.args, '--version'], {
        cwd: way.cwd ?? cwd,
        env,
        shell: way.shell ?? false,
      });
      check(
        out.status === 0 && out.stdout.trim() === version,
        `${way.name}: --version prints ${version} (got "${out.all.trim()}")`,
      );
      const help = run(way.command, [...way.args, '--help'], {
        cwd: way.cwd ?? cwd,
        env,
        shell: way.shell ?? false,
      });
      check(
        help.status === 0 &&
          help.stdout.includes('Usage: mossnote') &&
          help.stdout.includes(`Mossnote ${version}`),
        `${way.name}: --help describes the command`,
      );
    }
    process.stdout.write(`   ${ways.length} ways to start it agree on ${version}\n`);

    await runtimeChecks({
      program: process.execPath,
      baseArgs: [binFile],
      version,
      base,
      cwd,
      env,
      defaultDataDir,
      live,
    });

    step('Running it did not change the installed package');
    check(
      snapshotFolder(installed) === installedBefore,
      'no file was added to or changed in the installed package',
    );

    process.stdout.write(
      `\nnpm package check passed: ${passedChecks()} checks, Node ${process.versions.node}, ${platformKey()}.\n`,
    );
  } finally {
    for (const server of live) server.child.kill('SIGKILL');
    await sleep(300);
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
