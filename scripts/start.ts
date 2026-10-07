import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `npm start`: build if `dist` is missing or stale, start the production server, and open the
 * browser (the server does the opening). Stale means any source file, migration, lockfile or
 * build config is newer than the built server or web app.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = path.join(root, 'dist', 'server', 'index.js');
const webEntry = path.join(root, 'dist', 'web', 'index.html');

function newestMtime(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target)
    .reduce((newest, name) => Math.max(newest, newestMtime(path.join(target, name))), stat.mtimeMs);
}

function needsBuild(): boolean {
  if (!fs.existsSync(serverEntry) || !fs.existsSync(webEntry)) return true;
  const builtAt = Math.min(fs.statSync(serverEntry).mtimeMs, fs.statSync(webEntry).mtimeMs);
  const inputs = [
    'src',
    'drizzle',
    'package-lock.json',
    'package.json',
    'vite.config.ts',
    'tsup.config.ts',
    'tsconfig.base.json',
    'tsconfig.server.json',
    'tsconfig.web.json',
    'tsconfig.shared.json',
  ];
  return inputs.some((input) => newestMtime(path.join(root, input)) > builtAt);
}

if (needsBuild()) {
  process.stdout.write('Building Mossnote…\n');
  const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const server = spawn(process.execPath, [serverEntry], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production' },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code) => process.exit(code ?? 0));
