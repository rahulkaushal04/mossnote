import { PDF_LIMITS, type PdfLimits, type PdfText, type PdfTextExtractor } from '@mossnote/core';

/** The slice of Electron's UtilityProcess this module uses (faked in tests). */
export interface UtilityLike {
  postMessage(message: unknown): void;
  on(event: 'message', cb: (m: unknown) => void): unknown;
  on(event: 'exit', cb: (code: number) => void): unknown;
  kill(): boolean;
}
export type ForkUtility = (
  entry: string,
  args: string[],
  options: { serviceName: string; stdio: 'ignore'; execArgv: string[]; env: Record<string, string> },
) => UtilityLike;

function valid(m: unknown, maxTextBytes: number): PdfText | string {
  const r = m as { ok?: unknown; text?: unknown; pages?: unknown; truncated?: unknown; error?: unknown } | null;
  if (!r || typeof r !== 'object') return 'extraction failed';
  if (r.ok !== true) return typeof r.error === 'string' ? r.error.slice(0, 300) : 'extraction failed';
  if (typeof r.text !== 'string' || typeof r.pages !== 'number' || typeof r.truncated !== 'boolean')
    return 'extraction failed';
  // The child enforces the cap; the parent does not trust it.
  if (Buffer.byteLength(r.text, 'utf8') > maxTextBytes) return 'extracted text over the limit';
  return { text: r.text, pages: r.pages, truncated: r.truncated };
}

/** PdfTextExtractor backed by an Electron utilityProcess: own OS process, heap limit, kill timer. */
export function createUtilityExtractor(o: {
  fork: ForkUtility;
  entry: string;
  limits?: Partial<PdfLimits>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}): PdfTextExtractor {
  const limits: PdfLimits = { ...PDF_LIMITS, ...o.limits };
  const setT = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = o.clearTimer ?? ((t) => clearTimeout(t as NodeJS.Timeout));
  const running = new Set<UtilityLike>();
  return {
    extract(path) {
      return new Promise<PdfText>((resolve, reject) => {
        let child: UtilityLike;
        try {
          child = o.fork(o.entry, [], {
            serviceName: 'mossnote-pdf',
            stdio: 'ignore',
            execArgv: [`--max-old-space-size=${limits.maxOldSpaceMb}`],
            env: { NODE_ENV: 'production' },
          });
        } catch (e) {
          return reject(e instanceof Error ? e : new Error('cannot start the PDF process'));
        }
        running.add(child);
        let settled = false;
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearT(timer);
          running.delete(child);
          child.kill();
          fn();
        };
        const timer = setT(
          () => done(() => reject(new Error('PDF text extraction timed out'))),
          limits.timeoutMs,
        );
        child.on('message', (m) => {
          const v = valid(m, limits.maxTextBytes);
          done(() => (typeof v === 'string' ? reject(new Error(v)) : resolve(v)));
        });
        // A crash or an out-of-memory kill ends the process without a reply.
        child.on('exit', (code) =>
          done(() => reject(new Error(`PDF extractor exited (${String(code)})`))),
        );
        child.postMessage({
          path,
          limits: { maxPages: limits.maxPages, maxTextBytes: limits.maxTextBytes },
        });
      });
    },
    dispose() {
      for (const c of [...running]) c.kill();
      running.clear();
    },
  };
}
