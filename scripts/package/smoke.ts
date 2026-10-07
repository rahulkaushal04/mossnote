import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm run package:smoke -- <program>`: start a built standalone program (or a folder holding
 * it) the way a person would, and check that it serves the app, makes a journal in the data
 * folder, and keeps the unpacked copy of itself out of that folder. Used by the release workflow
 * before anything is published.
 */
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error(`${url} did not answer in ${timeoutMs / 1000} s.`);
    await sleep(250);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Smoke test failed: ${message}`);
}

export async function smoke(program: string): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-smoke-'));
  const dataDir = path.join(home, 'data');
  const env = {
    ...process.env,
    // Keep the unpacked copy in a throwaway place whichever system this is.
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, 'cache'),
    LOCALAPPDATA: path.join(home, 'local'),
    APPDATA: path.join(home, 'roaming'),
    MOSS_DATA_DIR: dataDir,
    MOSS_OPEN_BROWSER: '0',
    MOSS_PORT: String(await freePort()),
  };
  const url = `http://127.0.0.1:${env.MOSS_PORT}`;

  const version = spawnSync(program, ['--version'], { env, encoding: 'utf8' });
  assert(
    version.status === 0 && /^\d+\.\d+\.\d+/.test(version.stdout),
    '--version prints a version',
  );

  const child = spawn(program, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  try {
    // The first start unpacks the app, which takes a few seconds.
    await waitFor(`${url}/api/health`, 120_000);

    const page = await fetch(url);
    assert(page.ok && (await page.text()).includes('id="root"'), 'the app page is served');

    const made = await fetch(`${url}/api/journals`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Moss-Client': 'web' },
      body: JSON.stringify({ name: 'Smoke test', template: 'default' }),
    });
    assert(made.status === 201, `a journal can be made (got ${made.status})`);
    const settings = (await (await fetch(`${url}/api/settings`)).json()) as {
      calendar: { counter?: boolean };
    };
    assert(settings.calendar.counter === true, 'the Default template counts days');

    assert(fs.existsSync(path.join(dataDir, 'smoke-test.db')), 'the journal is in the data folder');
    const cacheHolds = (folder: string): boolean => {
      if (!fs.existsSync(folder)) return false;
      return fs.readdirSync(folder, { recursive: true }).some((f) => String(f).endsWith('.db'));
    };
    assert(
      !cacheHolds(path.join(home, 'cache')) && !cacheHolds(path.join(home, 'local')),
      'no journal is kept with the unpacked program',
    );
    process.stdout.write(`Smoke test passed: ${program}\n`);
  } catch (error) {
    process.stderr.write(`${output}\n`);
    throw error;
  } finally {
    child.kill('SIGTERM');
    await sleep(500);
    child.kill('SIGKILL');
    fs.rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const program = process.argv[2];
  if (!program) {
    process.stderr.write('Usage: npm run package:smoke -- <path to the program>\n');
    process.exit(1);
  }
  smoke(path.resolve(program)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
