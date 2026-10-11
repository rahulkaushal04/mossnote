import fs from 'node:fs';
import path from 'node:path';

/** Written next to the build to say which kind it is (`production`, or `e2e` with the hidden test route). */
export const BUILD_MODE_FILE = 'dist/.build-mode';

const INPUTS = [
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

function newestMtime(target: string): number {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return fs
    .readdirSync(target)
    .reduce((newest, name) => Math.max(newest, newestMtime(path.join(target, name))), stat.mtimeMs);
}

/**
 * True when `dist` is missing, is not a production build, or is older than any source file,
 * migration, lockfile or build config.
 */
export function needsBuild(root: string): boolean {
  const serverEntry = path.join(root, 'dist', 'server', 'index.js');
  const webEntry = path.join(root, 'dist', 'web', 'index.html');
  if (!fs.existsSync(serverEntry) || !fs.existsSync(webEntry)) return true;
  const modeFile = path.join(root, BUILD_MODE_FILE);
  if (!fs.existsSync(modeFile) || fs.readFileSync(modeFile, 'utf8').trim() !== 'production') {
    return true;
  }
  const builtAt = Math.min(fs.statSync(serverEntry).mtimeMs, fs.statSync(webEntry).mtimeMs);
  return INPUTS.some((input) => newestMtime(path.join(root, input)) > builtAt);
}
