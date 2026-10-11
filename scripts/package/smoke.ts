import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  freePort,
  isWindows,
  isolatedEnvironment,
  passedChecks,
  run,
  runtimeChecks,
  sleep,
  start,
  step,
  stop,
  waitForHealth,
  type Server,
} from './runtime-checks';

/** `npm run package:smoke -- <program or .tar.gz>`: the standalone program as a person gets it. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoVersion = (
  JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }
).version;

function cacheRoot(home: string): string {
  if (isWindows) return path.join(home, 'AppData', 'Local', 'Mossnote', 'Cache', 'app');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Caches', 'Mossnote', 'app');
  return path.join(home, '.cache', 'Mossnote', 'app');
}

function resolveProgram(input: string, into: string): string {
  if (!input.endsWith('.tar.gz')) {
    check(fs.existsSync(input), `${input} exists`);
    return input;
  }
  const listing = spawnSync('tar', ['-tzf', input], { encoding: 'utf8' });
  check(listing.status === 0, `the tarball can be listed:\n${listing.stderr}`);
  check(
    listing.stdout.trim() === 'mossnote',
    `the tarball holds the one file "mossnote" (found ${JSON.stringify(listing.stdout.trim())})`,
  );
  const unpacked = spawnSync('tar', ['-xzf', input, '-C', into], { encoding: 'utf8' });
  check(unpacked.status === 0, `the tarball can be unpacked with tar:\n${unpacked.stderr}`);
  const program = path.join(into, 'mossnote');
  check(
    (fs.statSync(program).mode & 0o111) === 0o111,
    'the unpacked program is executable by everyone, as a download that is unpacked must be',
  );
  return program;
}

export async function smoke(input: string): Promise<void> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-smoke-'));
  const live: Server[] = [];
  try {
    step('The program');
    const program = resolveProgram(path.resolve(input), base);
    const folder = path.join(base, 'with space');
    fs.mkdirSync(folder);
    const exe = path.join(folder, path.basename(program));
    fs.copyFileSync(program, exe);
    fs.chmodSync(exe, 0o755);
    process.stdout.write(
      `   ${path.basename(program)}, ${(fs.statSync(exe).size / 1024 / 1024).toFixed(0)} MB, ${process.platform}-${process.arch}\n`,
    );

    const { cwd, home, env, defaultDataDir } = isolatedEnvironment(path.join(base, 'user'));
    env.PATH = isWindows
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')
      : '/nonexistent';
    const cache = cacheRoot(home);

    step('Version and help');
    const version = run(exe, ['--version'], { cwd, env });
    check(
      version.status === 0 && version.stdout.trim() === repoVersion,
      `--version prints ${repoVersion} (got "${version.all.trim()}")`,
    );
    for (const flag of ['--help', '-h']) {
      const help = run(exe, [flag], { cwd, env });
      check(
        help.status === 0 &&
          help.stdout.includes('Usage: mossnote') &&
          help.stdout.includes(`Mossnote ${repoVersion}`) &&
          help.stdout.includes('includes its own Node.js'),
        `${flag} describes the program`,
      );
    }
    check(!fs.existsSync(cache), '--version and --help unpack nothing');

    step('The first start unpacks the app into the cache, once');
    const first = start(exe, [], { cwd, env, port: await freePort() });
    live.push(first);
    await waitForHealth(first);
    check(
      first.output().includes('unpacking for the first run'),
      'the first start says it is unpacking',
    );
    const [id, ...others] = fs.readdirSync(cache);
    check(
      id && others.length === 0,
      `the cache holds one copy (found ${fs.readdirSync(cache).join(', ')})`,
    );
    check(id.startsWith(`${repoVersion}-`), `the copy is named for the version (${id})`);
    check(fs.existsSync(path.join(cache, id, '.ready')), 'the copy is marked finished');
    check(
      fs.existsSync(path.join(cache, id, 'dist', 'server', 'index.js')),
      'the server is in the copy',
    );
    await stop(first);
    live.splice(live.indexOf(first), 1);

    const second = start(exe, [], { cwd, env, port: await freePort() });
    live.push(second);
    await waitForHealth(second);
    check(!second.output().includes('unpacking'), 'the second start reuses the copy');
    await stop(second);
    live.splice(live.indexOf(second), 1);

    step('The cache stays tidy and repairs itself');
    fs.mkdirSync(path.join(cache, '0.0.1-old'));
    fs.writeFileSync(path.join(cache, '0.0.1-old', 'x'), 'old');
    fs.mkdirSync(path.join(cache, `${id}.unpacking-2147483646`));
    fs.rmSync(path.join(cache, id, '.ready'));
    const repaired = start(exe, [], { cwd, env, port: await freePort() });
    live.push(repaired);
    await waitForHealth(repaired);
    check(
      repaired.output().includes('unpacking for the first run'),
      'a copy that is not marked finished is unpacked again',
    );
    check(
      fs.readdirSync(cache).join() === id,
      `an old version and a crashed unpack are removed (found ${fs.readdirSync(cache).join(', ')})`,
    );
    check(fs.existsSync(path.join(cache, id, '.ready')), 'the repaired copy is marked finished');
    await stop(repaired);
    live.splice(live.indexOf(repaired), 1);

    step('A cache that cannot be written is reported in plain words');
    const blockedHome = path.join(base, 'blocked');
    const blocked = isolatedEnvironment(blockedHome);
    blocked.env.PATH = env.PATH;
    fs.mkdirSync(path.dirname(cacheRoot(blocked.home)), { recursive: true });
    fs.writeFileSync(cacheRoot(blocked.home), 'a file where the folder should be');
    const refused = run(exe, ['--port', String(await freePort())], {
      cwd: blocked.cwd,
      env: blocked.env,
    });
    check(
      refused.status === 1 && refused.stderr.includes('could not unpack itself into'),
      `it says so and exits 1 (got ${refused.status}: ${refused.stderr.trim()})`,
    );
    check(
      refused.stderr.includes('XDG_CACHE_HOME') && refused.stderr.includes('LOCALAPPDATA'),
      'it says how to choose another place',
    );

    await runtimeChecks({
      program: exe,
      baseArgs: [],
      version: repoVersion,
      base,
      cwd,
      env,
      defaultDataDir,
      live,
    });

    step('Running it left only the cache behind');
    check(fs.readdirSync(cache).join() === id, 'the cache still holds just the one copy');
    const databases = fs
      .readdirSync(cache, { recursive: true })
      .filter((f) => String(f).endsWith('.db'));
    check(databases.length === 0, 'no journal is kept with the unpacked program');
    check(
      !fs.readdirSync(cache).some((name) => name.includes('.unpacking-')),
      'no unpacking is left half done',
    );
    process.stdout.write(
      `\nProgram check passed: ${passedChecks()} checks, ${process.platform}-${process.arch}.\n`,
    );
  } finally {
    for (const server of live) server.child.kill('SIGKILL');
    await sleep(500);
    fs.rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = process.argv[2];
  if (!program) {
    process.stderr.write('Usage: npm run package:smoke -- <the program, or its .tar.gz>\n');
    process.exit(1);
  }
  smoke(program).catch((error: unknown) => {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
