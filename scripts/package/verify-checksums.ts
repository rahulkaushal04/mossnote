import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** `npm run package:checksums [folder]`: checks every `<file>.sha256` in a folder (default `release`). */
export function verifyChecksums(folder: string): string[] {
  const names = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const problems: string[] = [];
  const sums = names.filter((name) => name.endsWith('.sha256'));
  if (sums.length === 0) problems.push(`${folder} holds no .sha256 file.`);
  for (const sumFile of sums) {
    const match = /^([0-9a-f]{64}) {2}(.+)\n?$/.exec(
      fs.readFileSync(path.join(folder, sumFile), 'utf8'),
    );
    if (!match) {
      problems.push(`${sumFile} is not "<sha256>  <file name>".`);
      continue;
    }
    const [, expected = '', target = ''] = match;
    if (target !== sumFile.slice(0, -'.sha256'.length)) {
      problems.push(`${sumFile} names ${target}, not the file it belongs to.`);
      continue;
    }
    const file = path.join(folder, target);
    if (!fs.existsSync(file)) {
      problems.push(`${sumFile}: ${target} is missing.`);
      continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== expected)
      problems.push(`${target}: checksum is ${actual}, expected ${expected}.`);
  }
  for (const name of names) {
    if (!name.endsWith('.sha256') && !sums.includes(`${name}.sha256`)) {
      problems.push(`${name} has no .sha256 file.`);
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const folder = path.resolve(process.argv[2] ?? 'release');
  const problems = fs.existsSync(folder) ? verifyChecksums(folder) : [`${folder} does not exist.`];
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`${problem}\n`);
    process.exit(1);
  }
  const count = fs.readdirSync(folder).filter((name) => name.endsWith('.sha256')).length;
  process.stdout.write(`${count} checksum(s) in ${folder} match.\n`);
}
