// Crash-test child for portability. Modes (argv): 
//   backup <dir>                 backs up in a loop until SIGKILLed
//   import <dir> <src> <batch>   imports <src>; prints "batch:N" after each batch; SIGKILLed by the parent
//   apply <dir> <k>              applyPendingRestore; SIGKILLs ITSELF before journal step k (1-based)
import { writeSync } from 'node:fs';
import { applyPendingRestore } from '../../packages/core/src/portability/restore.ts';
import { openWorkspace } from '../../packages/core/src/workspace.ts';

const [mode, dir, a, b] = process.argv.slice(2) as [string, string, string | undefined, string | undefined];
const out = (s: string) => writeSync(1, `${s}\n`);

if (mode === 'apply') {
  let n = 0;
  const k = Number(a);
  const r = applyPendingRestore(`${dir}/w.db`, {
    onStep: () => {
      if (++n === k) process.kill(process.pid, 'SIGKILL');
    },
  });
  out(r.ok ? 'applied' : `error ${r.error.message}`);
} else {
  const w = openWorkspace(`${dir}/w.db`, {
    attachments: { pdf: null },
    portability: { importLimits: { batchNotes: Number(b ?? 500) } },
  });
  if (!w.ok) throw new Error(w.error.message);
  out('ready');
  if (mode === 'backup') {
    for (;;) {
      const r = await w.value.portability.backup({ kind: 'manual' });
      out(r.ok ? 'done' : 'fail');
    }
  } else {
    const r = await w.value.portability.import({
      dir: a,
      hook: (label) => {
        if (label.startsWith('batch:')) out(label);
      },
    });
    out(r.ok ? 'imported' : `error ${r.error.message}`);
  }
}
