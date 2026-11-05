import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PDF_LIMITS, type PdfLimits, type PdfText } from './pdfExtract.ts';

/**
 * Where PDF text comes from. Production: the desktop stage passes an implementation backed by an
 * Electron utilityProcess running the same pure function. Core's default (and the Node tests) fork a
 * child process. Either way the parent enforces the kill timer.
 */
export interface PdfTextExtractor {
  /** `path` is a blob the caller already hash-verified. Rejects on timeout, crash or a bad PDF. */
  extract(path: string): Promise<PdfText>;
  /** Kills a running child (workspace closing). */
  dispose(): void;
}

export interface ForkOptions extends Partial<PdfLimits> {
  /** Override the runner script (tests use a hanging or crashing one). */
  runner?: string;
}

export function createForkExtractor(opts: ForkOptions = {}): PdfTextExtractor {
  const limits: PdfLimits = { ...PDF_LIMITS, ...opts };
  const runner = opts.runner ?? fileURLToPath(new URL('./pdfRunner.ts', import.meta.url));
  const running = new Set<{ kill(): void }>();
  return {
    extract(path) {
      return new Promise<PdfText>((resolve, reject) => {
        const child = fork(runner, [], {
          // No eval anywhere; heap limited; stdio detached from the parent.
          execArgv: [
            `--max-old-space-size=${limits.maxOldSpaceMb}`,
            '--experimental-strip-types',
            '--disable-warning=ExperimentalWarning',
          ],
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
          env: { NODE_ENV: 'production' },
        });
        const handle = { kill: () => void child.kill('SIGKILL') };
        running.add(handle);
        let settled = false;
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          running.delete(handle);
          child.kill('SIGKILL');
          fn();
        };
        const timer = setTimeout(
          () => done(() => reject(new Error('PDF text extraction timed out'))),
          limits.timeoutMs,
        );
        child.once('message', (m: unknown) => {
          const r = m as ({ ok: true } & PdfText) | { ok: false; error: string };
          done(() =>
            r && r.ok
              ? resolve({ text: r.text, pages: r.pages, truncated: r.truncated })
              : reject(new Error((r as { error?: string })?.error ?? 'extraction failed')),
          );
        });
        child.once('error', (e) => done(() => reject(e)));
        // 'exit' can overtake the last IPC message: give a pending reply a moment before calling it a crash.
        child.once('exit', (code) =>
          setTimeout(
            () => done(() => reject(new Error(`PDF extractor exited (${String(code)})`))),
            250,
          ),
        );
        child.send({ path, limits: { maxPages: limits.maxPages, maxTextBytes: limits.maxTextBytes } });
      });
    },
    dispose() {
      for (const h of [...running]) h.kill();
    },
  };
}
