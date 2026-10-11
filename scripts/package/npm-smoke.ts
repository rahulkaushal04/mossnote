import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { builtinModules } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

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
const isWindows = process.platform === 'win32';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

let passed = 0;
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Package check failed: ${message}`);
  passed++;
}
const step = (title: string) => process.stdout.write(`\n== ${title}\n`);

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  all: string;
}

/**
 * With a shell (needed for `.cmd` files on Windows) Node does not quote the arguments, so a path
 * such as `C:\\Users\\John Smith\\...` would be split in two. Quote what needs it.
 */
function forShell(value: string): string {
  return /[\s&()^|<>"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean } = {},
): Run {
  const shell = options.shell ?? false;
  const result: SpawnSyncReturns<string> = spawnSync(
    shell ? forShell(command) : command,
    shell ? args.map(forShell) : args,
    {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: 'utf8',
      shell,
      timeout: 300_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    all: `${result.stdout}${result.stderr}`,
  };
}

/** `npm` is a script on every system, and a `.cmd` file on Windows, which needs a shell. */
const npm = (args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
  run('npm', args, { ...options, shell: isWindows });

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

// ------------------------------------------------------------------------------------------
// The tarball
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

/** A home folder, a working folder and an environment that point nowhere near the real ones. */
function isolatedEnvironment(base: string): {
  home: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  defaultDataDir: string;
} {
  const home = path.join(base, 'home');
  const cwd = path.join(base, 'cwd');
  for (const folder of [home, cwd]) fs.mkdirSync(folder, { recursive: true });
  // Nothing from the developer's own setup may change the result.
  const env: NodeJS.ProcessEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.startsWith('MOSS_') && name !== 'NODE_ENV' && name !== 'npm_package_version',
    ),
  );
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
    MOSS_OPEN_BROWSER: '0',
  });
  delete env.XDG_DATA_HOME;
  delete env.XDG_CACHE_HOME;
  delete env.XDG_CONFIG_HOME;
  const defaultDataDir =
    process.platform === 'win32'
      ? path.join(home, 'AppData', 'Roaming', 'Mossnote')
      : process.platform === 'darwin'
        ? path.join(home, 'Library', 'Application Support', 'Mossnote')
        : path.join(home, '.local', 'share', 'mossnote');
  return { home, cwd, env, defaultDataDir };
}

interface Server {
  child: ChildProcess;
  port: number;
  url: string;
  output: () => string;
  exited: Promise<number | null>;
}

function start(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; port: number },
): Server {
  const shell = isWindows && /\.cmd$/i.test(command);
  const all = [...args, '--port', String(options.port)];
  const child = spawn(shell ? forShell(command) : command, shell ? all.map(forShell) : all, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell,
  });
  let text = '';
  child.stdout.on('data', (chunk: Buffer) => (text += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (text += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      resolve(code);
    });
  });
  return {
    child,
    port: options.port,
    url: `http://127.0.0.1:${options.port}`,
    output: () => text,
    exited,
  };
}

async function waitForHealth(server: Server): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const reply = await fetch(`${server.url}/api/health`);
      if (reply.ok) return (await reply.json()) as Record<string, unknown>;
    } catch {
      // Not up yet.
    }
    if (server.child.exitCode !== null) {
      throw new Error(
        `Package check failed: the server stopped while starting:\n${server.output()}`,
      );
    }
    if (Date.now() > deadline)
      throw new Error(`Package check failed: no answer from ${server.url}:\n${server.output()}`);
    await sleep(200);
  }
}

/** The status of `GET /api/health` sent with a chosen `Host` header, which `fetch` does not allow. */
function statusWithHost(port: number, host: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = http.get(
      { host: '127.0.0.1', port, path: '/api/health', headers: { Host: host } },
      (reply) => {
        reply.resume();
        resolve(reply.statusCode);
      },
    );
    request.once('error', reject);
  });
}

const json = { 'Content-Type': 'application/json', 'X-Moss-Client': 'web' };

/** Stop the way a person does (Ctrl+C or a service manager's stop) and report how it ended. */
async function stop(server: Server): Promise<{ code: number | null; graceful: boolean }> {
  if (isWindows) {
    // Windows has no signal a Node program can catch, so a stop is always abrupt there.
    server.child.kill();
    return { code: await server.exited, graceful: false };
  }
  server.child.kill('SIGTERM');
  const timer = setTimeout(() => server.child.kill('SIGKILL'), 15_000);
  const code = await server.exited;
  clearTimeout(timer);
  return { code, graceful: code === 0 };
}

function readDataFolderLine(server: Server): string {
  const line = /Data folder: (.+)/.exec(server.output())?.[1];
  check(line, `the server says where its data folder is:\n${server.output()}`);
  return line.trim();
}

const samePath = (a: string, b: string) =>
  fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

function snapshotFolder(folder: string): string {
  const entries: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(`${path.relative(folder, full)}:${fs.statSync(full).size}`);
    }
  };
  walk(folder);
  return entries.sort().join('\n');
}

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

    step('Mistakes on the command line are reported, and nothing starts');
    const mistakes: [string[], RegExp][] = [
      [['--prot', '4000'], /Unknown option "--prot"/],
      [['--port', 'abc'], /--port must be a whole number from 1 to 65535/],
      [['--port=70000'], /--port must be a whole number/],
      [['--journal', 'bad name'], /--journal must be/],
      [['--data-dir'], /--data-dir needs a value/],
      [['start'], /Unexpected argument "start"/],
    ];
    for (const [args, expected] of mistakes) {
      const out = run(process.execPath, [binFile, ...args], { cwd, env });
      check(
        out.status === 1 && expected.test(out.stderr),
        `${args.join(' ')}: exits 1 and says why (got ${out.status}: ${out.stderr.trim()})`,
      );
    }

    step('Start it with no options: journals go to the default data folder');
    const first = start(process.execPath, [binFile], { cwd, env, port: await freePort() });
    live.push(first);
    const health = await waitForHealth(first);
    check(
      health.ok === true && health.version === version,
      `the API reports version ${version} (got ${String(health.version)})`,
    );
    const folder = readDataFolderLine(first);
    check(samePath(folder, defaultDataDir), `the data folder is ${defaultDataDir} (got ${folder})`);

    const page = await fetch(first.url);
    const html = await page.text();
    check(page.ok && html.includes('id="root"'), 'the app page is served');
    const script = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    check(script, 'the page names a script');
    check((await fetch(`${first.url}${script}`)).ok, "the page's script is served");
    check(
      (await statusWithHost(first.port, 'example.com')) === 403,
      'a request that names another host is refused',
    );

    const made = await fetch(`${first.url}/api/journals`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ name: 'Smoke test', template: 'default' }),
    });
    check(made.status === 201, `a journal can be made (got ${made.status})`);
    const note = await fetch(`${first.url}/api/notes`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ body: 'A lantern by the gate #lead' }),
    });
    check(note.status === 201 || note.status === 200, `a note can be written (got ${note.status})`);
    const found = (await (await fetch(`${first.url}/api/search?q=lantrn`)).json()) as {
      results?: unknown[];
    };
    check(
      JSON.stringify(found).includes('lantern'),
      'search finds the note, even with a typing mistake',
    );
    const exported = await (await fetch(`${first.url}/api/data/export.json`)).text();
    check(
      exported.includes('A lantern by the gate') && exported.includes(version),
      'an export holds the note and the app version',
    );

    check(
      fs.existsSync(path.join(defaultDataDir, 'smoke-test.db')),
      'the journal is a file in the data folder',
    );
    check(
      fs.existsSync(path.join(defaultDataDir, 'backups')),
      'snapshots go in a backups folder beside it',
    );
    check(fs.readdirSync(cwd).length === 0, 'nothing was written to the working folder');

    step('A second copy, and a busy port, are reported in plain words');
    const second = run(process.execPath, [binFile, '--port', String(await freePort())], {
      cwd,
      env,
    });
    check(
      second.status === 1 && /already running/i.test(second.stderr),
      `a second copy for the same journal refuses to start (got ${second.status}: ${second.stderr.trim()})`,
    );
    const busy = run(
      process.execPath,
      [binFile, '--port', String(first.port), '--data-dir', path.join(base, 'other-data')],
      { cwd, env },
    );
    check(
      busy.status === 1 && busy.stderr.includes('already in use') && busy.stderr.includes('--port'),
      `a busy port is reported with the option to change it (got ${busy.stderr.trim()})`,
    );

    step('Stop it, start it again, and the journal is still there');
    const stopped = await stop(first);
    live.splice(live.indexOf(first), 1);
    if (isWindows) {
      process.stdout.write(
        '   Windows has no catchable stop signal; the next start recovers the lock instead.\n',
      );
    } else {
      check(stopped.code === 0, `a stop (SIGTERM) ends with exit code 0 (got ${stopped.code})`);
      check(
        !fs.existsSync(path.join(defaultDataDir, 'smoke-test.lock')),
        'the lock file is removed on a clean stop',
      );
      check(
        !fs.existsSync(path.join(defaultDataDir, 'smoke-test.db-wal')),
        'the write-ahead log is folded back into the journal on a clean stop',
      );
    }
    const again = start(process.execPath, [binFile], { cwd, env, port: await freePort() });
    live.push(again);
    await waitForHealth(again);
    const kept = await (await fetch(`${again.url}/api/data/export.json`)).text();
    check(kept.includes('A lantern by the gate'), 'the note is still there after a restart');

    // A crash or a power cut leaves the lock behind: the next start must not be locked out.
    again.child.kill('SIGKILL');
    await again.exited;
    live.splice(live.indexOf(again), 1);
    const afterCrash = start(process.execPath, [binFile], { cwd, env, port: await freePort() });
    live.push(afterCrash);
    await waitForHealth(afterCrash);
    check(
      (await (await fetch(`${afterCrash.url}/api/data/export.json`)).text()).includes(
        'A lantern by the gate',
      ),
      'after a hard kill the next start recovers the lock and keeps the note',
    );
    await stop(afterCrash);
    live.splice(live.indexOf(afterCrash), 1);

    step('Where the data goes: --data-dir, MOSS_DATA_DIR, empty values and relative paths');
    const viaFlag = path.join(base, 'via-flag');
    const viaEnv = path.join(base, 'via-env');
    const flagWins = start(process.execPath, [binFile, '--data-dir', viaFlag], {
      cwd,
      env: { ...env, MOSS_DATA_DIR: viaEnv },
      port: await freePort(),
    });
    live.push(flagWins);
    await waitForHealth(flagWins);
    check(samePath(readDataFolderLine(flagWins), viaFlag), '--data-dir wins over MOSS_DATA_DIR');
    await stop(flagWins);
    live.splice(live.indexOf(flagWins), 1);

    const fromEnv = start(process.execPath, [binFile], {
      cwd,
      env: { ...env, MOSS_DATA_DIR: viaEnv },
      port: await freePort(),
    });
    live.push(fromEnv);
    await waitForHealth(fromEnv);
    check(
      samePath(readDataFolderLine(fromEnv), viaEnv),
      'MOSS_DATA_DIR is used when there is no option',
    );
    await stop(fromEnv);
    live.splice(live.indexOf(fromEnv), 1);

    const empty = start(process.execPath, [binFile], {
      cwd,
      env: { ...env, MOSS_DATA_DIR: '' },
      port: await freePort(),
    });
    live.push(empty);
    await waitForHealth(empty);
    check(
      samePath(readDataFolderLine(empty), defaultDataDir),
      'an empty MOSS_DATA_DIR means the default folder, not the current one',
    );
    check(
      fs.readdirSync(cwd).length === 0,
      'an empty MOSS_DATA_DIR wrote nothing to the working folder',
    );
    await stop(empty);
    live.splice(live.indexOf(empty), 1);

    const relative = start(process.execPath, [binFile, '--data-dir', 'relative-data'], {
      cwd,
      env,
      port: await freePort(),
    });
    live.push(relative);
    await waitForHealth(relative);
    check(
      samePath(readDataFolderLine(relative), path.join(cwd, 'relative-data')),
      'a relative --data-dir is taken from where the command was run',
    );
    await stop(relative);
    live.splice(live.indexOf(relative), 1);

    if (!isWindows) {
      const blocker = path.join(base, 'a-file');
      fs.writeFileSync(blocker, 'x');
      const blocked = run(
        process.execPath,
        [binFile, '--data-dir', blocker, '--port', String(await freePort())],
        { cwd, env },
      );
      check(
        blocked.status === 1 &&
          blocked.stderr.includes('cannot use its data folder') &&
          blocked.stderr.includes('--data-dir'),
        `a data folder that is a file is reported plainly (got ${blocked.stderr.trim()})`,
      );
    }

    step('A development NODE_ENV in the shell does not break the installed app');
    const dev = start(process.execPath, [binFile, '--data-dir', viaFlag], {
      cwd,
      env: { ...env, NODE_ENV: 'development' },
      port: await freePort(),
    });
    live.push(dev);
    await waitForHealth(dev);
    check(
      (await fetch(dev.url)).ok,
      'the app page is still served when NODE_ENV=development is set',
    );
    await stop(dev);
    live.splice(live.indexOf(dev), 1);

    step('Running it did not change the installed package');
    check(
      snapshotFolder(installed) === installedBefore,
      'no file was added to or changed in the installed package',
    );

    process.stdout.write(
      `\nnpm package check passed: ${passed} checks, Node ${process.versions.node}, ${platformKey()}.\n`,
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
