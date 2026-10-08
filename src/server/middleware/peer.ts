import type { Context } from 'hono';

/**
 * The address on the other end of the connection, as the operating system reports it. Unlike the
 * `Host` header, a client cannot choose it. Undefined when the request did not come through a
 * socket (tests, the browser runtime).
 */
export function peerAddress(c: Context): string | undefined {
  const env: unknown = c.env;
  if (typeof env !== 'object' || env === null || !('incoming' in env)) return undefined;
  const incoming: unknown = env.incoming;
  if (typeof incoming !== 'object' || incoming === null || !('socket' in incoming))
    return undefined;
  const socket: unknown = incoming.socket;
  if (typeof socket !== 'object' || socket === null || !('remoteAddress' in socket))
    return undefined;
  return typeof socket.remoteAddress === 'string' ? socket.remoteAddress : undefined;
}
