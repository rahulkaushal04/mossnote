/**
 * Minimal POSIX ustar writer and hardened reader (no dependency). Stock `tar -xf` opens the result.
 * The reader accepts regular files only: no links, directories, sparse files, base-256 sizes, long
 * names or prefixes. Names are ASCII path text without `..`. Entry policy (names, order, sizes) belongs
 * to the caller through `onEntry`.
 */
import { corrupt, PortError } from './errors.ts';

export const BLOCK = 512;
/** ustar holds 11 octal digits: just under 8 GiB per entry. */
export const MAX_ENTRY = 8 ** 11 - 1;
export const TAR_END = Buffer.alloc(BLOCK * 2);

export const padFor = (size: number): number => (BLOCK - (size % BLOCK)) % BLOCK;

export function tarHeader(name: string, size: number): Buffer {
  if (size < 0 || size > MAX_ENTRY || !Number.isInteger(size))
    throw new PortError('validation', 'A file is too large for the backup format (8 GiB limit).');
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(name)) throw new PortError('internal', 'bad tar entry name');
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 'latin1');
  h.write('0000644\0', 100, 'latin1');
  h.write('0000000\0', 108, 'latin1');
  h.write('0000000\0', 116, 'latin1');
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1');
  h.write('00000000000\0', 136, 'latin1'); // mtime 0: deterministic bytes
  h.fill(0x20, 148, 156);
  h.write('0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

export interface TarHead {
  name: string;
  size: number;
}

/** Parses one header block. `'end'` for an all-zero block. Throws a `corrupt` PortError on anything odd. */
export function parseHeader(b: Buffer): TarHead | 'end' {
  if (b.every((x) => x === 0)) return 'end';
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : b[i]!;
  const stored = /^[0-7]{1,6}[\0 ]*$/.exec(b.toString('latin1', 148, 156));
  if (!stored || parseInt(stored[0].trim().replace(/\0/g, ''), 8) !== sum) throw corrupt();
  if (b[156] !== 0x30) throw corrupt(); // '0' regular file only: no links, dirs, pax, sparse
  if (b.toString('latin1', 257, 262) !== 'ustar') throw corrupt();
  if (!b.subarray(157, 257).every((x) => x === 0)) throw corrupt(); // linkname
  if (!b.subarray(345, 500).every((x) => x === 0)) throw corrupt(); // prefix
  if ((b[124]! & 0x80) !== 0) throw corrupt(); // base-256 size
  const sz = /^([0-7]{1,11})[\0 ]*$/.exec(b.toString('latin1', 124, 136));
  if (!sz) throw corrupt();
  let end = 0;
  while (end < 100 && b[end] !== 0) end++;
  const name = b.toString('latin1', 0, end);
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(name) || name.startsWith('/') || name.split('/').some((p) => p === '..' || p === '' || p === '.'))
    throw corrupt();
  return { name, size: parseInt(sz[1]!, 8) };
}

export interface TarSink {
  write(chunk: Buffer): void | Promise<void>;
  end(): void | Promise<void>;
  abort?(): void;
}

class ByteReader {
  private buf: Buffer = Buffer.alloc(0);
  private done = false;
  private readonly it: AsyncIterator<Buffer>;
  constructor(src: AsyncIterable<Buffer>) {
    this.it = src[Symbol.asyncIterator]();
  }
  private async fill(): Promise<boolean> {
    if (this.done) return false;
    const r = await this.it.next();
    if (r.done) {
      this.done = true;
      return false;
    }
    this.buf = this.buf.length ? Buffer.concat([this.buf, r.value]) : r.value;
    return true;
  }
  /** Exactly n bytes; null when the stream ends cleanly before the first byte. */
  async exact(n: number): Promise<Buffer | null> {
    while (this.buf.length < n) {
      if (!(await this.fill())) {
        if (this.buf.length === 0) return null;
        throw corrupt('This backup file is incomplete.');
      }
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
  /** Up to max bytes, at least one. */
  async some(max: number): Promise<Buffer> {
    while (this.buf.length === 0) if (!(await this.fill())) throw corrupt('This backup file is incomplete.');
    const out = this.buf.subarray(0, max);
    this.buf = this.buf.subarray(max);
    return out;
  }
  /** True when only zero bytes remain (at most `limit` of them). */
  async onlyZeros(limit: number): Promise<boolean> {
    let seen = 0;
    for (;;) {
      if (this.buf.length === 0 && !(await this.fill())) return true;
      seen += this.buf.length;
      if (seen > limit || !this.buf.every((x) => x === 0)) return false;
      this.buf = Buffer.alloc(0);
    }
  }
}

export interface TarLimits {
  maxEntries: number;
  /** Largest allowed entry (the caller narrows per entry in onEntry by throwing). */
  maxEntry?: number;
}

/**
 * Streams entries to the sinks `onEntry` returns. `onEntry` throws to refuse (wrong name/order/size).
 * Ends only on two zero blocks followed by nothing but zero padding.
 */
export async function readTar(
  src: AsyncIterable<Buffer>,
  onEntry: (head: TarHead, index: number) => TarSink | Promise<TarSink>,
  limits: TarLimits,
): Promise<number> {
  const r = new ByteReader(src);
  let index = 0;
  for (;;) {
    const hb = await r.exact(BLOCK);
    if (!hb) throw corrupt('This backup file is incomplete.');
    const h = parseHeader(hb);
    if (h === 'end') {
      const second = await r.exact(BLOCK);
      if (!second || !second.every((x) => x === 0)) throw corrupt();
      if (!(await r.onlyZeros(64 * 1024))) throw corrupt();
      return index;
    }
    if (index >= limits.maxEntries || h.size > (limits.maxEntry ?? MAX_ENTRY)) throw corrupt();
    const sink = await onEntry(h, index++);
    try {
      let left = h.size;
      while (left > 0) {
        const c = await r.some(Math.min(left, 1024 * 1024));
        left -= c.length;
        await sink.write(c);
      }
      const pad = padFor(h.size);
      if (pad) {
        const p = await r.exact(pad);
        if (!p || !p.every((x) => x === 0)) throw corrupt();
      }
      await sink.end();
    } catch (e) {
      try {
        sink.abort?.();
      } catch {
        /* the original error is the one to report */
      }
      throw e;
    }
  }
}
