import type {
  StartupProblem,
  WorkerOutput,
  WorkerReply,
  WorkerRequest,
} from '@shared/standaloneProtocol';

/**
 * The page's end of the standalone web app: starts the worker that holds the journal, and
 * answers the app's `fetch` calls by asking it. To the rest of the app this looks like a server
 * that happens to be very close by.
 */

/** Requests with no body of their own. */
const BODYLESS = new Set(['GET', 'HEAD']);

export class StartupError extends Error {
  readonly problem: StartupProblem;
  constructor(problem: StartupProblem, message: string) {
    super(message);
    this.name = 'StartupError';
    this.problem = problem;
  }
}

export interface JournalWorker {
  /** Same shape as `fetch`; the request never leaves the page. */
  fetch: typeof fetch;
  terminate(): void;
}

interface Pending {
  resolve(response: Response): void;
  reject(error: Error): void;
}

/** The smallest part of `Worker` the client uses, so tests can stand in for it. */
export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<WorkerOutput>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** Start the real worker. */
export const createJournalWorker = (): WorkerLike =>
  new Worker(new URL('../../standalone/worker.ts', import.meta.url), { type: 'module' });

const toResponse = (reply: WorkerReply): Response =>
  new Response(reply.body, {
    status: reply.status,
    statusText: reply.statusText,
    headers: reply.headers,
  });

/**
 * Wait for the worker to start, then serve requests through it. Rejects with a
 * {@link StartupError} when it cannot start.
 */
export function connectToWorker(worker: WorkerLike): Promise<JournalWorker> {
  const pending = new Map<number, Pending>();
  let nextId = 1;

  const failAll = (message: string) => {
    for (const request of pending.values()) request.reject(new TypeError(message));
    pending.clear();
  };

  const fetchFromWorker: typeof fetch = async (input, init) => {
    // A path such as `/api/notes` is relative to the page, as it is for the browser's own fetch.
    const target = input instanceof Request ? input : new URL(String(input), window.location.href);
    const request = new Request(target, init);
    const url = new URL(request.url);
    const body = BODYLESS.has(request.method) ? null : await request.arrayBuffer();
    const id = nextId++;
    return new Promise<Response>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(
        {
          type: 'request',
          id,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: [...request.headers.entries()],
          body,
        },
        body ? [body] : [],
      );
    });
  };

  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      const output = event.data;
      switch (output.type) {
        case 'ready':
          resolve({
            fetch: fetchFromWorker,
            terminate: () => {
              worker.terminate();
            },
          });
          return;
        case 'failed':
          worker.terminate();
          reject(new StartupError(output.problem, output.message));
          return;
        case 'reply': {
          const request = pending.get(output.id);
          pending.delete(output.id);
          request?.resolve(toResponse(output));
        }
      }
    };
    worker.onerror = (event) => {
      failAll('The journal stopped.');
      reject(new StartupError('failed', event.message));
    };
  });
}
