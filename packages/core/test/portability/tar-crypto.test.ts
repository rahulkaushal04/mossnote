import { describe, expect, it } from 'vitest';
import { decryptStream, encryptStream, HEADER_LEN, isEncrypted } from '../../src/portability/crypto.ts';
import { PortError } from '../../src/portability/errors.ts';
import { padFor, parseHeader, readTar, tarHeader, TAR_END, type TarSink } from '../../src/portability/tar.ts';
import { FAST_CRYPTO } from './util.ts';

async function* from(...bufs: Buffer[]): AsyncGenerator<Buffer> {
  for (const b of bufs) yield b;
}
async function collect(it: AsyncIterable<Buffer>): Promise<Buffer> {
  const out: Buffer[] = [];
  for await (const c of it) out.push(c);
  return Buffer.concat(out);
}
const entry = (name: string, data: Buffer): Buffer[] => [tarHeader(name, data.length), data, Buffer.alloc(padFor(data.length))];
const tar = (...es: Buffer[][]): Buffer => Buffer.concat([...es.flat(), TAR_END]);

async function read(buf: Buffer, maxEntries = 10) {
  const seen: { name: string; data: Buffer }[] = [];
  await readTar(
    from(buf),
    ({ name }) => {
      const parts: Buffer[] = [];
      const sink: TarSink = {
        write: (c) => void parts.push(Buffer.from(c)),
        end: () => void seen.push({ name, data: Buffer.concat(parts) }),
      };
      return sink;
    },
    { maxEntries },
  );
  return seen;
}
const rejects = async (p: Promise<unknown>) => {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(PortError);
};

describe('tar reader', () => {
  it('round-trips entries of any size, including empty and block-aligned', async () => {
    const a = Buffer.from('hello');
    const b = Buffer.alloc(512, 7);
    const c = Buffer.alloc(0);
    const got = await read(tar(entry('a', a), entry('dir/b', b), entry('c', c)));
    expect(got.map((g) => g.name)).toEqual(['a', 'dir/b', 'c']);
    expect(got[0]!.data.equals(a) && got[1]!.data.equals(b) && got[2]!.data.length === 0).toBe(true);
  });
  it('is chunk-boundary independent', async () => {
    const t = tar(entry('a', Buffer.alloc(1500, 1)), entry('b', Buffer.from('x')));
    const seen: string[] = [];
    const pieces: Buffer[] = [];
    for (let i = 0; i < t.length; i += 37) pieces.push(t.subarray(i, i + 37));
    await readTar(from(...pieces), ({ name }) => ({ write: () => undefined, end: () => void seen.push(name) }), { maxEntries: 5 });
    expect(seen).toEqual(['a', 'b']);
  });
  it('refuses a flipped header byte, a link, a directory, a long name, base-256 size and a prefix', async () => {
    const base = tar(entry('a', Buffer.from('x')));
    const flip = Buffer.from(base);
    flip[3]! ^= 1;
    await rejects(read(flip));
    for (const [off, val] of [
      [156, 0x32], // symlink
      [156, 0x35], // directory
      [156, 0x78], // pax header
    ] as const) {
      const h = tarHeader('a', 1);
      h[off] = val;
      h.fill(0x20, 148, 156);
      let sum = 0;
      for (const x of h) sum += x;
      h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
      await rejects(read(Buffer.concat([h, Buffer.alloc(512), TAR_END])));
    }
    const prefixed = tarHeader('a', 1);
    prefixed.write('pre', 345, 'latin1');
    prefixed.fill(0x20, 148, 156);
    let sum = 0;
    for (const x of prefixed) sum += x;
    prefixed.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
    await rejects(read(Buffer.concat([prefixed, Buffer.alloc(512), TAR_END])));
    expect(() => tarHeader('../x', 1)).not.toThrow(); // charset allows dots; the READER rejects '..' segments
    expect(() => parseHeader(tarHeader('../x', 1))).toThrow(PortError);
    expect(() => parseHeader(tarHeader('/abs', 1))).toThrow(PortError);
    expect(() => tarHeader('a'.repeat(101), 1)).toThrow();
    expect(() => tarHeader('a', 8 ** 11)).toThrow(PortError);
  });
  it('refuses truncation, missing end blocks, junk after the end and too many entries', async () => {
    const t = tar(entry('a', Buffer.alloc(900, 1)));
    await rejects(read(t.subarray(0, 700)));
    await rejects(read(t.subarray(0, t.length - 1024)));
    await rejects(read(Buffer.concat([t, Buffer.from('junk')])));
    await rejects(read(tar(entry('a', Buffer.from('1')), entry('b', Buffer.from('2'))), 1));
    await expect(read(Buffer.concat([t, Buffer.alloc(2048)]))).resolves.toHaveLength(1); // zero padding is fine
  });
  it('lets the entry policy refuse (throw from onEntry)', async () => {
    await rejects(
      readTar(from(tar(entry('evil', Buffer.from('x')))), () => { throw new PortError('corrupt', 'no'); }, { maxEntries: 2 }),
    );
  });
});

describe('encryption (PT-10)', () => {
  const plain = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  const enc = async (p = plain, pass = 'correct horse') => collect(encryptStream(from(p), pass, FAST_CRYPTO));
  const dec = (b: Buffer, pass = 'correct horse') => collect(decryptStream(from(b), pass));

  it('round-trips across several chunks and across arbitrary input chunking', async () => {
    const e = await enc();
    expect(isEncrypted(e)).toBe(true);
    expect(e.length).toBe(HEADER_LEN + plain.length + 5 * 16); // 4 full chunks + 1 short (1024-byte chunks)
    expect((await dec(e)).equals(plain)).toBe(true);
    const small: Buffer[] = [];
    for (let i = 0; i < plain.length; i += 333) small.push(plain.subarray(i, i + 333));
    const e2 = await collect(encryptStream(from(...small), 'pw12345678', FAST_CRYPTO));
    expect((await dec(e2, 'pw12345678')).equals(plain)).toBe(true);
    const exact = Buffer.alloc(2048, 3); // an exact multiple of the chunk size still ends with a "last" chunk
    expect((await dec(await enc(exact))).equals(exact)).toBe(true);
  });
  it('a wrong passphrase fails at the first chunk with a validation error and releases nothing', async () => {
    const e = await enc();
    const out: Buffer[] = [];
    let thrown: unknown;
    try {
      for await (const c of decryptStream(from(e), 'wrong passphrase')) out.push(c);
    } catch (x) {
      thrown = x;
    }
    expect(thrown).toMatchObject({ code: 'validation' });
    expect(out).toHaveLength(0);
  });
  it('the passphrase is not in the ciphertext, and two encryptions differ (random salt and nonce prefix)', async () => {
    const a = await enc();
    const b = await enc();
    expect(a.equals(b)).toBe(false);
    expect(a.includes(Buffer.from('correct horse'))).toBe(false);
  });
  it('a flipped bit anywhere (header, any chunk, tag) is refused', async () => {
    const e = await enc();
    for (const pos of [0, 9, 10, 20, 30, 37, HEADER_LEN, HEADER_LEN + 500, HEADER_LEN + 1030, e.length - 1, e.length - 20]) {
      const bad = Buffer.from(e);
      bad[pos]! ^= 0x01;
      await rejects(dec(bad));
    }
  });
  it('truncation (at a chunk boundary or inside one), extra data and a missing last chunk are refused', async () => {
    const e = await enc();
    const unit = 1024 + 16;
    await rejects(dec(e.subarray(0, HEADER_LEN + unit * 2))); // clean chunk boundary: last-flag nonce mismatch
    await rejects(dec(e.subarray(0, e.length - 5)));
    await rejects(dec(e.subarray(0, HEADER_LEN)));
    await rejects(dec(e.subarray(0, 10)));
    await rejects(dec(Buffer.concat([e, Buffer.from('extra')])));
  });
  it('reordered or duplicated chunks are refused', async () => {
    const e = await enc();
    const unit = 1024 + 16;
    const chunk = (i: number) => e.subarray(HEADER_LEN + i * unit, HEADER_LEN + (i + 1) * unit);
    const swapped = Buffer.concat([e.subarray(0, HEADER_LEN), chunk(1), chunk(0), chunk(2), chunk(3), e.subarray(HEADER_LEN + 4 * unit)]);
    await rejects(dec(swapped));
    const dup = Buffer.concat([e.subarray(0, HEADER_LEN), chunk(0), chunk(0), chunk(1), chunk(2), chunk(3), e.subarray(HEADER_LEN + 4 * unit)]);
    await rejects(dec(dup));
  });
  it('hostile header parameters are refused before any key derivation', async () => {
    const e = await enc();
    const mutate = (fn: (h: Buffer) => void): Buffer => {
      const b = Buffer.from(e);
      fn(b);
      return b;
    };
    for (const bad of [
      mutate((b) => (b[10] = 25)), // N = 2^25
      mutate((b) => (b[10] = 3)),
      mutate((b) => (b[11] = 32)), // r
      mutate((b) => (b[12] = 200)), // p
      mutate((b) => b.writeUInt32BE(0x7fffffff, 36)), // chunk size
      mutate((b) => b.writeUInt32BE(10, 36)),
      mutate((b) => (b[8] = 9)), // version
      mutate((b) => (b[9] = 2)), // kdf
    ]) {
      const t0 = Date.now();
      await rejects(dec(bad));
      expect(Date.now() - t0).toBeLessThan(2000);
    }
  });
});
