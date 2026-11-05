import { createUlid } from '../ids/ulid.ts';
import { err, ok, type AppError, type Result } from '../result.ts';
import { CANCELLED, toPortResult } from './errors.ts';

export type JobKind = 'export' | 'import' | 'backup' | 'restore';
export interface JobSnapshot {
  jobId: string;
  kind: JobKind;
  phase: string;
  done: number;
  total: number;
}
export interface JobEventOut extends JobSnapshot {
  result?: unknown;
  error?: { code: AppError['code']; message: string };
}
export interface JobControl {
  progress(phase: string, done: number, total: number): void;
  signal: AbortSignal;
}

/**
 * One job at a time (a second gets `unavailable`). The runner never throws: a failing job ends with an
 * event carrying only {code, message}. `drain()` is what quit waits for; `abort()` cancels cooperatively.
 */
export function createJobRunner(emit: (e: JobEventOut) => void, busyElsewhere: () => boolean = () => false) {
  const ulid = createUlid(() => Date.now());
  let current: (JobSnapshot & { ac: AbortController; done$: Promise<void> }) | undefined;
  let last: (JobSnapshot & { ok: boolean; error?: { code: AppError['code']; message: string } }) | undefined;
  return {
    start(kind: JobKind, run: (c: JobControl) => Promise<Result<unknown>>): Result<{ jobId: string }> {
      if (current || busyElsewhere()) return err('unavailable', 'Another export, import or backup is already running.');
      const ac = new AbortController();
      const snap: JobSnapshot = { jobId: ulid(), kind, phase: 'starting', done: 0, total: 0 };
      const job = Object.assign(snap, { ac, done$: Promise.resolve() });
      current = job;
      const ctl: JobControl = {
        signal: ac.signal,
        progress(phase, done, total) {
          job.phase = phase;
          job.done = done;
          job.total = total;
          emit({ jobId: job.jobId, kind, phase, done, total });
        },
      };
      job.done$ = (async () => {
        let r: Result<unknown>;
        try {
          r = await run(ctl);
        } catch (e) {
          r = toPortResult(e);
        }
        const base = { jobId: job.jobId, kind, phase: r.ok ? 'done' : 'failed', done: job.done, total: job.total };
        const error = r.ok ? undefined : { code: r.error.code, message: ac.signal.aborted ? CANCELLED : String(r.error.message) };
        last = { ...base, ok: r.ok, ...(error ? { error } : {}) };
        current = undefined; // free the slot before the final event so a listener may start the next job
        try {
          emit(r.ok ? { ...base, result: r.value } : { ...base, error: error! });
        } catch {
          /* a bad listener must not break the runner */
        }
      })();
      return ok({ jobId: job.jobId });
    },
    status: (): { job?: JobSnapshot; last?: NonNullable<typeof last> } => ({
      ...(current ? { job: { jobId: current.jobId, kind: current.kind, phase: current.phase, done: current.done, total: current.total } } : {}),
      ...(last ? { last } : {}),
    }),
    get busy(): boolean {
      return current !== undefined;
    },
    abort(): void {
      current?.ac.abort();
    },
    /** Resolves when no job is running (quit waits for this). */
    async drain(): Promise<void> {
      while (current) await current.done$;
    },
  };
}
export type JobRunner = ReturnType<typeof createJobRunner>;
