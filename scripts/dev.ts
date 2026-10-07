import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_ARGS } from './dev-command';

/**
 * `npm run dev`: the API under `tsx watch` on 4317 and Vite on 5173 with an /api proxy. Uses
 * ./.dev-data so development never touches the real journal.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name: string) => path.join(root, 'node_modules', '.bin', name);

const api = spawn(bin('tsx'), API_ARGS, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    MOSS_DATA_DIR: process.env.MOSS_DATA_DIR ?? path.join(root, '.dev-data'),
    MOSS_OPEN_BROWSER: '0',
  },
});
const web = spawn(bin('vite'), [], { cwd: root, stdio: 'inherit' });

const children: ChildProcess[] = [api, web];
const stop = () => {
  for (const child of children) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
