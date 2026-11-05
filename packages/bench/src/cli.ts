import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIZES, type SizeName } from './dataset.ts';
import { runBench, type BenchResult } from './harness.ts';
import { compare, renderReport, toBaseline, type Baseline } from './report.ts';

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkg, '..', '..');
const dataDir = join(root, '.bench-data');
const resultsDir = join(pkg, 'results');
const baselinePath = join(pkg, 'baseline.json');
const docPath = join(root, 'docs', 'benchmarks.md');
const log = (m: string): void =>
  console.log(`[bench ${new Date().toISOString().slice(11, 19)}] ${m}`);

const save = (name: string, r: BenchResult): void => {
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(join(resultsDir, `${name}.json`), JSON.stringify(r));
};

function writeReport(): void {
  const rs = (Object.keys(SIZES) as SizeName[])
    .map((s) => join(resultsDir, `${s}.json`))
    .filter(existsSync)
    .map((p) => JSON.parse(readFileSync(p, 'utf8')) as BenchResult);
  mkdirSync(dirname(docPath), { recursive: true });
  writeFileSync(docPath, renderReport(rs));
  log(`wrote ${docPath}`);
}

async function main(): Promise<number> {
  const [cmd = 'run', ...args] = process.argv.slice(2);
  const flag = (n: string): boolean => args.includes(`--${n}`);
  const sizesArg = args.find((a) => a.startsWith('--sizes='))?.slice(8) ?? '1k,10k,100k';
  const sizes = sizesArg.split(',') as SizeName[];
  for (const s of sizes) if (!(s in SIZES)) throw new Error(`unknown size ${s}`);

  if (cmd === 'report') {
    writeReport();
    return 0;
  }
  if (cmd === 'check') {
    if (!existsSync(baselinePath)) {
      log('no baseline.json: run `npm run bench:quick -- --update-baseline` first');
      return 1;
    }
    const base = JSON.parse(readFileSync(baselinePath, 'utf8')) as Baseline;
    const fresh = await runBench({ size: '10k', dataDir, quick: true, log });
    save('quick-10k-check', fresh);
    const bad = compare(base, fresh);
    for (const b of bad)
      log(
        `REGRESSION ${b.metric}: p95 ${b.baseline.toFixed(2)} -> ${b.fresh.toFixed(2)} ms (+${b.pct.toFixed(0)}%)`,
      );
    log(
      bad.length
        ? `FAIL: ${bad.length} metric(s) regressed by more than 20%`
        : 'OK: no p95 regressed by more than 20%',
    );
    return bad.length ? 1 : 0;
  }
  if (cmd !== 'run') throw new Error(`unknown command ${cmd}`);
  const quick = flag('quick');
  for (const size of sizes) {
    log(`running ${size}${quick ? ' (quick)' : ''}`);
    const r = await runBench({ size, dataDir, quick, log });
    save(quick ? `quick-${size}` : size, r);
    if (flag('update-baseline')) {
      writeFileSync(baselinePath, JSON.stringify(toBaseline(r), null, 2));
      log(`baseline written from ${size}`);
    }
  }
  if (!quick) writeReport();
  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
