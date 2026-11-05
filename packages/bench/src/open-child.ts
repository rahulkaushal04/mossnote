// Child process for the open-time metric: prints one JSON line the moment the workspace is ready.
import { performance } from 'node:perf_hooks';
import { openWorkspace } from '../../core/src/index.ts';

const t0 = performance.now();
const r = openWorkspace(process.argv[2] as string);
const t1 = performance.now();
if (!r.ok) {
  console.log(JSON.stringify({ error: r.error.message }));
  process.exit(1);
}
// `sinceProcessStart` counts runtime boot and module loading too (performance.now() is relative to process start).
console.log(
  JSON.stringify({ openMs: t1 - t0, sinceProcessStart: t1, rss: process.memoryUsage().rss }),
);
r.value.close();
