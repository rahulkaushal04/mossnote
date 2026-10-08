import type { StartupProblem } from '@shared/standaloneProtocol';
import { setApiTransport } from '../lib/api';
import { requestPersistentStorage } from './persist';
import { registerServiceWorker } from './serviceWorker';
import { holdStorageLock } from './storageLock';
import { missingFeature } from './support';
import { connectToWorker, createJournalWorker, StartupError } from './workerClient';

export type StandaloneStart =
  { ok: true } | { ok: false; problem: StartupProblem; message: string };

/**
 * Start the standalone web app's journal before the app is shown: check the browser can host
 * it, make sure no other tab has it, start the worker and point the app's requests at it. The
 * app is rendered only when this says `ok`.
 */
export async function startStandalone(): Promise<StandaloneStart> {
  const missing = missingFeature();
  if (missing !== null) return { ok: false, problem: 'unsupported', message: missing };

  if ((await holdStorageLock('locks' in navigator ? navigator.locks : undefined)) === 'busy') {
    return { ok: false, problem: 'storage_busy', message: '' };
  }

  try {
    const worker = await connectToWorker(createJournalWorker());
    setApiTransport(worker.fetch);
  } catch (error) {
    if (error instanceof StartupError) {
      return { ok: false, problem: error.problem, message: error.message };
    }
    return { ok: false, problem: 'failed', message: error instanceof Error ? error.message : '' };
  }

  // Best effort, and not worth waiting for: it only improves how safely the journal is kept.
  void requestPersistentStorage();
  registerServiceWorker();
  return { ok: true };
}
