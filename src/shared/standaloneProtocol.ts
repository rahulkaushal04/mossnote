/**
 * Messages between the page and the worker that runs the journal inside the browser. Types only,
 * so both sides agree on them without importing each other. A request is a plain HTTP request
 * taken apart (the page's `fetch` is answered by the worker, not by a network); bodies travel as
 * transferred buffers.
 */

export interface WorkerRequest {
  type: 'request';
  /** Matches the reply to the request. */
  id: number;
  method: string;
  /** Path and query, such as `/api/notes?limit=20`. */
  path: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

export interface WorkerReply {
  type: 'reply';
  id: number;
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ArrayBuffer | null;
}

/** Why the worker could not start. */
export type StartupProblem = 'unsupported' | 'storage_busy' | 'failed';

export type WorkerEvent =
  { type: 'ready' } | { type: 'failed'; problem: StartupProblem; message: string };

/** Everything the worker sends to the page. */
export type WorkerOutput = WorkerReply | WorkerEvent;
