import type {
  StartupProblem,
  WorkerOutput,
  WorkerReply,
  WorkerRequest,
} from '@shared/standaloneProtocol';
import migrations from 'virtual:moss-migrations';
import { createSahPool } from './pool/sahPool';
import { createRuntime, type Runtime } from './runtime';
import { loadSqlite, openStoragePool } from './sqlite/load';

/**
 * The worker that runs Mossnote inside the browser. It starts SQLite, opens the storage pool,
 * builds the same app the server runs, and answers the page's requests. It is a thin shell:
 * everything it does is in the modules it imports.
 *
 * It lives in a worker because the browser only lets a worker use the synchronous file access
 * the pool needs, and because the page stays responsive while SQL runs.
 */

declare const __MOSS_VERSION__: string;

/** Requests with no body of their own. */
const BODYLESS = new Set(['GET', 'HEAD']);

const send = (output: WorkerOutput, transfer: Transferable[] = []): void => {
  postMessage(output, transfer);
};

/** Tell the page why starting failed, in terms it can act on. */
function classify(error: unknown): { problem: StartupProblem; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  // `navigator.storage` is missing altogether outside a secure context.
  if (!('storage' in navigator) || typeof navigator.storage.getDirectory !== 'function') {
    return { problem: 'unsupported', message: "This browser can't store files for Mossnote." };
  }
  // Private windows refuse file storage with this generic error (Safari, and Firefox before 111).
  if (name === 'UnknownError' || /unknown transient reason/i.test(message)) {
    return {
      problem: 'unsupported',
      message: 'Private windows cannot keep files for Mossnote. Open it in a normal window.',
    };
  }
  // Another tab holds the files: the browser refuses a second exclusive handle on them.
  if (name === 'NoModificationAllowedError' || /access handle|locked|in use/i.test(message)) {
    return { problem: 'storage_busy', message };
  }
  return { problem: 'failed', message };
}

async function start(): Promise<Runtime> {
  const sqlite3 = await loadSqlite();
  const pool = createSahPool(sqlite3, await openStoragePool(sqlite3));
  return createRuntime({
    pool,
    migrations,
    clock: { now: () => Date.now() },
    version: __MOSS_VERSION__,
  });
}

const starting = start();
starting.then(
  () => {
    send({ type: 'ready' });
  },
  (error: unknown) => {
    send({ type: 'failed', ...classify(error) });
  },
);

async function answer(runtime: Runtime, message: WorkerRequest): Promise<WorkerReply> {
  const request = new Request(`http://localhost${message.path}`, {
    method: message.method,
    headers: message.headers,
    ...(BODYLESS.has(message.method) || message.body === null ? {} : { body: message.body }),
  });
  const response = await runtime.app.fetch(request);
  const body = response.body === null ? null : await response.arrayBuffer();
  return {
    type: 'reply',
    id: message.id,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body,
  };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  starting
    .then((runtime) => answer(runtime, message))
    .then((reply) => {
      send(reply, reply.body ? [reply.body] : []);
    })
    .catch(() => {
      send({
        type: 'reply',
        id: message.id,
        status: 500,
        statusText: 'Internal Server Error',
        headers: [['content-type', 'application/json']],
        body: new TextEncoder().encode(
          JSON.stringify({ error: { code: 'internal', message: 'Something went wrong.' } }),
        ).buffer,
      });
    });
};
