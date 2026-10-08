import net from 'node:net';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from './env';
import { ALL_INTERFACES, startListener, type Listener } from './listener';

let listener: Listener | undefined;
afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

const app = new Hono<Env>().get('/', (c) => c.text('hello'));

/** A port nothing is using right now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

const get = async (port: number) => (await fetch(`http://127.0.0.1:${port}/`)).text();

describe('the listener', () => {
  it('serves the app on the address it was given', async () => {
    const port = await freePort();

    listener = await startListener({ app, host: '127.0.0.1', port });

    expect(await get(port)).toBe('hello');
    expect(listener.host).toBe('127.0.0.1');
  });

  it('moves to every interface and back while the app keeps answering', async () => {
    const port = await freePort();
    listener = await startListener({ app, host: '127.0.0.1', port });

    await listener.rebind(ALL_INTERFACES);
    expect(listener.host).toBe(ALL_INTERFACES);
    expect(await get(port)).toBe('hello');

    await listener.rebind('127.0.0.1');
    expect(listener.host).toBe('127.0.0.1');
    expect(await get(port)).toBe('hello');
  });

  it('fails to start when the port is taken', async () => {
    const port = await freePort();
    listener = await startListener({ app, host: '127.0.0.1', port });

    await expect(startListener({ app, host: '127.0.0.1', port })).rejects.toMatchObject({
      code: 'EADDRINUSE',
    });
  });

  it('stops answering once closed', async () => {
    const port = await freePort();
    const running = await startListener({ app, host: '127.0.0.1', port });

    await running.close();

    await expect(get(port)).rejects.toThrow();
  });
});
