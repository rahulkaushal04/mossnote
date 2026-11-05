import type { RpcEvent } from '@mossnote/core/rpc';
import { createStore, type Store } from '../app/store';
import type { ToastStore } from '../toast/toastStore';
import { summarize, type JobFinal, type JobProgress } from './summary';

export interface JobState {
  running: JobProgress | null;
  last: JobFinal | null;
}
export interface JobStore extends Store<JobState> {
  onEvent(e: RpcEvent): void;
  /** Seeds `running` from portability.status (a job started before the dialog opened). */
  seed(job: JobProgress | undefined): void;
  clearLast(): void;
  /** A mounted view that shows job results itself; without one a finished job is announced by a toast. */
  watch(): () => void;
}

export function createJobStore(toasts: ToastStore): JobStore {
  const store = createStore<JobState>({ running: null, last: null });
  let watchers = 0;
  return {
    ...store,
    onEvent(e) {
      if (e.type !== 'job') return;
      const { jobId, kind, phase, done, total } = e;
      if (phase !== 'done' && phase !== 'failed') {
        store.set({ running: { jobId, kind, phase, done, total } });
        return;
      }
      const last: JobFinal = {
        jobId,
        kind,
        ok: phase === 'done' && !e.error,
        ...(e.result ? { result: e.result } : {}),
        ...(e.error ? { error: e.error } : {}),
      };
      store.set({ running: null, last });
      if (watchers === 0)
        toasts.push({ message: summarize(last), lifetimeMs: last.ok ? 6000 : 15_000 });
    },
    seed(job) {
      // A job that already finished (its final event beat this status reply) must not come back.
      if (job && !store.get().running && store.get().last?.jobId !== job.jobId)
        store.set({ running: job });
    },
    clearLast: () => store.set({ last: null }),
    watch() {
      watchers++;
      return () => void watchers--;
    },
  };
}
