import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import type { Env } from './env';

/**
 * The server's socket. It can move between addresses while the app keeps running, which is how
 * phone access is switched on and off without a restart: loopback only (this computer), or
 * every network interface (this computer and phones on the same network).
 */

/** The address that means "every network interface". */
export const ALL_INTERFACES = '0.0.0.0';

export interface Listener {
  readonly host: string;
  /** Stop listening and listen again on `host`. Restores the old address if that fails. */
  rebind(host: string): Promise<void>;
  /** Stop listening and drop open connections. */
  close(): Promise<void>;
}

export interface ListenOptions {
  app: Hono<Env>;
  host: string;
  port: number;
}

type NodeServer = ReturnType<typeof serve>;

function listen({ app, host, port }: ListenOptions): Promise<NodeServer> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port });
    const fail = (error: Error) => {
      reject(error);
    };
    server.once('error', fail);
    server.once('listening', () => {
      server.off('error', fail);
      resolve(server);
    });
  });
}

function stop(server: NodeServer): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
    // Without this, a browser tab holding a keep-alive connection would keep the old address open.
    if ('closeAllConnections' in server) server.closeAllConnections();
  });
}

/** Start listening. Rejects with the Node error (for example `EADDRINUSE`) when it cannot. */
export async function startListener(options: ListenOptions): Promise<Listener> {
  let server = await listen(options);
  let host = options.host;
  return {
    get host() {
      return host;
    },
    async rebind(next) {
      if (next === host) return;
      await stop(server);
      try {
        server = await listen({ ...options, host: next });
        host = next;
      } catch (error) {
        server = await listen({ ...options, host });
        throw error;
      }
    },
    close: () => stop(server),
  };
}
