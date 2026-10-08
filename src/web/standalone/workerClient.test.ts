// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { WorkerOutput, WorkerRequest } from '@shared/standaloneProtocol';
import { connectToWorker, StartupError, type WorkerLike } from './workerClient';

/** A worker that records what it is sent and answers on demand. */
function fakeWorker() {
  const sent: WorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (message) => {
      sent.push(message);
    },
    terminate: () => undefined,
    onmessage: null,
    onerror: null,
  };
  const say = (output: WorkerOutput) => {
    worker.onmessage?.({ data: output } as MessageEvent<WorkerOutput>);
  };
  return { worker, sent, say };
}

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

describe('connecting to the worker', () => {
  it('resolves once the worker says it is ready', async () => {
    const { worker, say } = fakeWorker();
    const connecting = connectToWorker(worker);

    say({ type: 'ready' });

    expect(typeof (await connecting).fetch).toBe('function');
  });

  it('rejects with the reason when the worker cannot start', async () => {
    const { worker, say } = fakeWorker();
    const connecting = connectToWorker(worker);

    say({ type: 'failed', problem: 'storage_busy', message: 'locked' });

    await expect(connecting).rejects.toMatchObject({
      name: 'StartupError',
      problem: 'storage_busy',
      message: 'locked',
    });
    expect(StartupError).toBeDefined();
  });

  it('rejects when the worker crashes while starting', async () => {
    const { worker } = fakeWorker();
    const connecting = connectToWorker(worker);

    worker.onerror?.({ message: 'boom' } as ErrorEvent);

    await expect(connecting).rejects.toMatchObject({ problem: 'failed', message: 'boom' });
  });
});

describe('fetching through the worker', () => {
  async function ready() {
    const fixture = fakeWorker();
    const connecting = connectToWorker(fixture.worker);
    fixture.say({ type: 'ready' });
    return { ...fixture, journal: await connecting };
  }

  it('sends the method, path with query, and headers, and returns the reply', async () => {
    const { journal, sent, say } = await ready();

    const response = journal.fetch('http://localhost/api/notes?limit=5', {
      headers: { 'X-Moss-Client': 'web' },
    });
    const [request] = sent;
    say({
      type: 'reply',
      id: request?.id ?? 0,
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: bytes('{"items":[]}'),
    });

    expect(request).toMatchObject({ method: 'GET', path: '/api/notes?limit=5', body: null });
    expect(request?.headers).toContainEqual(['x-moss-client', 'web']);
    const answered = await response;
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ items: [] });
  });

  it('sends a body as bytes', async () => {
    const { journal, sent } = await ready();

    void journal.fetch('/api/notes', { method: 'POST', body: '{"body":"x"}' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [request] = sent;
    expect(new TextDecoder().decode(request?.body ?? new ArrayBuffer(0))).toBe('{"body":"x"}');
  });

  it('answers a reply with no body, such as 204', async () => {
    const { journal, sent, say } = await ready();

    const response = journal.fetch('/api/notes/x', { method: 'DELETE' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    say({
      type: 'reply',
      id: sent[0]?.id ?? 0,
      status: 204,
      statusText: '',
      headers: [],
      body: null,
    });

    expect((await response).status).toBe(204);
  });

  it('matches each reply to its own request, whatever order they arrive in', async () => {
    const { journal, sent, say } = await ready();

    const first = journal.fetch('/api/one');
    const second = journal.fetch('/api/two');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [one, two] = sent;
    say({
      type: 'reply',
      id: two?.id ?? 0,
      status: 200,
      statusText: '',
      headers: [],
      body: bytes('two'),
    });
    say({
      type: 'reply',
      id: one?.id ?? 0,
      status: 200,
      statusText: '',
      headers: [],
      body: bytes('one'),
    });

    expect(await (await first).text()).toBe('one');
    expect(await (await second).text()).toBe('two');
  });

  it('fails waiting requests when the worker dies later, as a network error would', async () => {
    const { journal, worker } = await ready();

    const waiting = journal.fetch('/api/slow');
    await new Promise((resolve) => setTimeout(resolve, 0));
    worker.onerror?.({ message: 'gone' } as ErrorEvent);

    await expect(waiting).rejects.toBeInstanceOf(TypeError);
  });
});
