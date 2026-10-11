import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

/** What the npm and standalone-program smoke tests share. */

export const isWindows = process.platform === 'win32';
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
export const passedChecks = () => passed;

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Package check failed: ${message}`);
  passed++;
}
export const step = (title: string) => process.stdout.write(`\n== ${title}\n`);

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
  all: string;
}

/**
 * With a shell (needed for `.cmd` files on Windows) Node does not quote the arguments, so a path
 * such as `C:\\Users\\John Smith\\...` would be split in two. Quote what needs it.
 */
export function forShell(value: string): string {
  return /[\s&()^|<>"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

export function run(
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

export function freePort(): Promise<number> {
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

/** A home folder, a working folder and an environment that point nowhere near the real ones. */
export function isolatedEnvironment(base: string): {
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

export interface Server {
  child: ChildProcess;
  port: number;
  url: string;
  output: () => string;
  exited: Promise<number | null>;
}

export function start(
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

export async function waitForHealth(server: Server): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 120_000;
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
export function statusWithHost(port: number, host: string): Promise<number | undefined> {
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

export const json = { 'Content-Type': 'application/json', 'X-Moss-Client': 'web' };

/** Stop the way a person does (Ctrl+C or a service manager's stop) and report how it ended. */
export async function stop(server: Server): Promise<{ code: number | null; graceful: boolean }> {
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

export function readDataFolderLine(server: Server): string {
  const line = /Data folder: (.+)/.exec(server.output())?.[1];
  check(line, `the server says where its data folder is:\n${server.output()}`);
  return line.trim();
}

export const samePath = (a: string, b: string) =>
  fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

export function snapshotFolder(folder: string): string {
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

export interface RuntimeContext {
  program: string;
  baseArgs: string[];
  version: string;
  base: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  defaultDataDir: string;
  live: Server[];
}

export async function runtimeChecks(context: RuntimeContext): Promise<void> {
  const { program, baseArgs, version, base, cwd, env, defaultDataDir, live } = context;
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
    const out = run(program, [...baseArgs, ...args], { cwd, env });
    check(
      out.status === 1 && expected.test(out.stderr),
      `${args.join(' ')}: exits 1 and says why (got ${out.status}: ${out.stderr.trim()})`,
    );
  }

  step('Start it with no options: journals go to the default data folder');
  const first = start(program, baseArgs, { cwd, env, port: await freePort() });
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
  const second = run(program, [...baseArgs, '--port', String(await freePort())], {
    cwd,
    env,
  });
  check(
    second.status === 1 && /already running/i.test(second.stderr),
    `a second copy for the same journal refuses to start (got ${second.status}: ${second.stderr.trim()})`,
  );
  const busy = run(
    program,
    [...baseArgs, '--port', String(first.port), '--data-dir', path.join(base, 'other-data')],
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
  const again = start(program, baseArgs, { cwd, env, port: await freePort() });
  live.push(again);
  await waitForHealth(again);
  const kept = await (await fetch(`${again.url}/api/data/export.json`)).text();
  check(kept.includes('A lantern by the gate'), 'the note is still there after a restart');

  // A crash or a power cut leaves the lock behind: the next start must not be locked out.
  again.child.kill('SIGKILL');
  await again.exited;
  live.splice(live.indexOf(again), 1);
  const afterCrash = start(program, baseArgs, { cwd, env, port: await freePort() });
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

  if (!isWindows) {
    // Ctrl+C, and closing the terminal window, stop it as cleanly as a service manager's stop.
    for (const [name, signal] of [
      ['Ctrl+C (SIGINT)', 'SIGINT'],
      ['closing the terminal (SIGHUP)', 'SIGHUP'],
    ] as const) {
      const server = start(program, baseArgs, { cwd, env, port: await freePort() });
      live.push(server);
      await waitForHealth(server);
      server.child.kill(signal);
      const code = await server.exited;
      live.splice(live.indexOf(server), 1);
      check(code === 0, `${name} ends with exit code 0 (got ${code})`);
      check(
        !fs.existsSync(path.join(defaultDataDir, 'smoke-test.lock')),
        `the lock file is removed after ${name}`,
      );
    }
  }

  step('Where the data goes: --data-dir, MOSS_DATA_DIR, empty values and relative paths');
  const viaFlag = path.join(base, 'via-flag');
  const viaEnv = path.join(base, 'via-env');
  const flagWins = start(program, [...baseArgs, '--data-dir', viaFlag], {
    cwd,
    env: { ...env, MOSS_DATA_DIR: viaEnv },
    port: await freePort(),
  });
  live.push(flagWins);
  await waitForHealth(flagWins);
  check(samePath(readDataFolderLine(flagWins), viaFlag), '--data-dir wins over MOSS_DATA_DIR');
  await stop(flagWins);
  live.splice(live.indexOf(flagWins), 1);

  const fromEnv = start(program, baseArgs, {
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

  const empty = start(program, baseArgs, {
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

  const relative = start(program, [...baseArgs, '--data-dir', 'relative-data'], {
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
      program,
      [...baseArgs, '--data-dir', blocker, '--port', String(await freePort())],
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
  const dev = start(program, [...baseArgs, '--data-dir', viaFlag], {
    cwd,
    env: { ...env, NODE_ENV: 'development' },
    port: await freePort(),
  });
  live.push(dev);
  await waitForHealth(dev);
  check((await fetch(dev.url)).ok, 'the app page is still served when NODE_ENV=development is set');
  await stop(dev);
  live.splice(live.indexOf(dev), 1);
}
