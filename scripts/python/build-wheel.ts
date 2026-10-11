import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFolder } from '../package/archive';
import { isDeadWeight, stageApp } from '../package/build-binary';
import { toPep440 } from './version';

/**
 * `npm run package:python`: builds the wheel from the real `npm run build` output into
 * release/python. Needs `pip install build`. Set PYTHON to choose the interpreter.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const python = path.join(root, 'python');
const appDir = path.join(python, 'src', 'mossnote', '_app');
const work = path.join(root, 'build', 'python');
const outDir = path.join(root, 'release', 'python');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  version: string;
};

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed.`);
}

function main(): void {
  for (const needed of [
    'dist/server/index.js',
    'dist/web/index.html',
    'drizzle',
    'bin/mossnote.js',
  ]) {
    if (!fs.existsSync(path.join(root, needed))) {
      throw new Error(`${needed} is missing. Run "npm run build" first.`);
    }
  }
  const expected = toPep440(pkg.version);
  const declared = /^version = "([^"]+)"$/m.exec(
    fs.readFileSync(path.join(python, 'pyproject.toml'), 'utf8'),
  )?.[1];
  if (declared !== expected) {
    throw new Error(
      `package.json says ${pkg.version}, which is ${expected} in Python, but python/pyproject.toml says ${declared ?? 'nothing'}. Make them agree.`,
    );
  }

  process.stdout.write('Staging the app with its production dependencies…\n');
  const stage = stageApp(work);
  const files = readFolder(
    stage,
    (relative) =>
      isDeadWeight(relative) ||
      relative === 'package-lock.json' ||
      // Left out of the npm package too.
      /^drizzle\/meta\/.*_snapshot\.json$/.test(relative),
  );
  for (const name of ['mossnote.js', 'options.js']) {
    files.push({
      path: `bin/${name}`,
      executable: false,
      data: fs.readFileSync(path.join(root, 'bin', name)),
    });
  }

  fs.rmSync(appDir, { recursive: true, force: true });
  for (const file of files) {
    const target = path.join(appDir, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data);
  }
  const server = files.find((file) => file.path === 'dist/server/index.js');
  fs.writeFileSync(
    path.join(appDir, 'BUILD.json'),
    `${JSON.stringify(
      {
        npmVersion: pkg.version,
        pythonVersion: expected,
        serverSha256: crypto
          .createHash('sha256')
          .update(server?.data ?? '')
          .digest('hex'),
        files: files.length,
      },
      null,
      2,
    )}\n`,
  );
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(python, 'LICENSE'));
  process.stdout.write(`Copied ${files.length} files into ${path.relative(root, appDir)}.\n`);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(path.join(python, 'build'), { recursive: true, force: true });
  const interpreter = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  run(interpreter, ['-m', 'build', '--wheel', '--outdir', outDir, python], root);

  const wheel = fs.readdirSync(outDir).find((name) => name.endsWith('.whl'));
  if (!wheel) throw new Error('The build made no wheel.');
  const expectedName = `mossnote-${expected}-py3-none-any.whl`;
  if (wheel !== expectedName) throw new Error(`Expected ${expectedName}, the build made ${wheel}.`);
  const sum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(outDir, wheel)))
    .digest('hex');
  process.stdout.write(`\nBuilt ${path.join(outDir, wheel)}\nSHA-256 ${sum}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
