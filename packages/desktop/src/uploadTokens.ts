import fsp from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export interface TokenFs {
  realpath(p: string): Promise<string>;
  stat(p: string): Promise<{ isFile(): boolean }>;
  access(p: string, mode: number): Promise<void>;
}
const nodeTokenFs: TokenFs = { realpath: fsp.realpath, stat: fsp.stat, access: fsp.access };

export interface UploadTokenOptions {
  fs?: TokenFs;
  now?: () => number;
  newToken: () => string;
  ttlMs?: number;
  max?: number;
}

const MAX_PATH = 4096;

/**
 * Main-process only: turns a file the user picked or dropped into an opaque, single-use, short-lived token.
 * The renderer never learns or supplies a path; `resolve` feeds `createDispatcher({resolveUploadPath})`.
 */
export function createUploadTokens(o: UploadTokenOptions) {
  const fs = o.fs ?? nodeTokenFs;
  const now = o.now ?? Date.now;
  const ttl = o.ttlMs ?? 60_000;
  const max = o.max ?? 256;
  const map = new Map<string, { path: string; expires: number }>();

  const purge = () => {
    const t = now();
    for (const [k, v] of map) if (v.expires <= t) map.delete(k);
  };

  return {
    /** A token for a regular, readable file (symlinks are resolved first), or undefined when refused. */
    async register(p: unknown): Promise<string | undefined> {
      if (typeof p !== 'string' || p.length === 0 || p.length > MAX_PATH || p.includes('\0'))
        return undefined;
      if (!path.isAbsolute(p)) return undefined;
      let real: string;
      try {
        real = await fs.realpath(p);
        if (!(await fs.stat(real)).isFile()) return undefined; // directory, FIFO, socket, device
        await fs.access(real, constants.R_OK);
      } catch {
        return undefined;
      }
      purge();
      if (map.size >= max) return undefined;
      const token = o.newToken();
      map.set(token, { path: real, expires: now() + ttl });
      return token;
    },
    /** Single use: the token is gone after the first call, valid or not. */
    resolve(token: string): string | undefined {
      const v = map.get(token);
      map.delete(token);
      return v && v.expires > now() ? v.path : undefined;
    },
    get size(): number {
      return map.size;
    },
  };
}
export type UploadTokens = ReturnType<typeof createUploadTokens>;
