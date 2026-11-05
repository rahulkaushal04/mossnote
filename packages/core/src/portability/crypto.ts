/**
 * Passphrase encryption of backup packages (PT-10). Approved design (decisions M6):
 * scrypt (N=2^17, r=8, p=1) -> 32-byte key; AES-256-GCM over 1 MiB chunks. Nonce = 7-byte random prefix,
 * u32 BE chunk counter, last-chunk flag byte. The 40-byte header is the AAD of every chunk, so a flipped
 * header byte, a dropped/reordered/duplicated chunk and a truncated stream all fail authentication.
 * Plaintext of a chunk is released only after its tag verified. The passphrase is never stored.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { PortError } from './errors.ts';

export const MAGIC = Buffer.from('MOSSBAK\0', 'latin1');
export const HEADER_LEN = 40;
const VERSION = 1;
const KDF_SCRYPT = 1;
export const CHUNK = 1024 * 1024;
const TAG = 16;
export const DEFAULT_LOG_N = 17;
const MIN_LOG_N = 14;
const MAX_LOG_N = 20;
const MAX_CHUNK = 4 * 1024 * 1024;
const MIN_CHUNK = 1024;

export interface CryptoParams {
  /** Test seam only: lower cost so suites stay fast. Production uses the defaults. */
  logN?: number;
  chunkSize?: number;
}

const WRONG = 'Wrong passphrase, or the backup is damaged.';

function deriveKey(pass: string, salt: Buffer, logN: number, r: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((resolve, reject) =>
    scryptCb(
      Buffer.from(pass.normalize('NFC'), 'utf8'),
      salt,
      32,
      { N, r, p: 1, maxmem: 129 * N * r + 4 * 1024 * 1024 },
      (e, k) => (e ? reject(e) : resolve(k)),
    ),
  );
}

const nonce = (prefix: Buffer, counter: number, last: boolean): Buffer => {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0);
  n.writeUInt32BE(counter >>> 0, 7);
  n[11] = last ? 1 : 0;
  return n;
};

export const isEncrypted = (head: Buffer): boolean =>
  head.length >= MAGIC.length && head.subarray(0, MAGIC.length).equals(MAGIC);

export async function* encryptStream(
  src: AsyncIterable<Buffer>,
  passphrase: string,
  params: CryptoParams = {},
): AsyncGenerator<Buffer> {
  const logN = params.logN ?? DEFAULT_LOG_N;
  const chunkSize = params.chunkSize ?? CHUNK;
  const salt = randomBytes(16);
  const prefix = randomBytes(7);
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0);
  header[8] = VERSION;
  header[9] = KDF_SCRYPT;
  header[10] = logN;
  header[11] = 8;
  header[12] = 1;
  salt.copy(header, 13);
  prefix.copy(header, 29);
  header.writeUInt32BE(chunkSize, 36);
  const key = await deriveKey(passphrase, salt, logN, 8);
  yield header;
  let counter = 0;
  const seal = (plain: Buffer, last: boolean): Buffer => {
    if (counter > 0xfffffffe) throw new PortError('internal', 'backup too large to encrypt');
    const c = createCipheriv('aes-256-gcm', key, nonce(prefix, counter++, last));
    c.setAAD(header);
    return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  };
  let pending: Buffer = Buffer.alloc(0);
  for await (const b of src) {
    pending = pending.length ? Buffer.concat([pending, b]) : b;
    // Only emit a chunk when more bytes are known to follow, so the final one can carry the last flag.
    while (pending.length > chunkSize) {
      yield seal(pending.subarray(0, chunkSize), false);
      pending = pending.subarray(chunkSize);
    }
  }
  yield seal(pending, true);
}

export async function* decryptStream(
  src: AsyncIterable<Buffer>,
  passphrase: string,
): AsyncGenerator<Buffer> {
  const it = src[Symbol.asyncIterator]();
  let buf: Buffer = Buffer.alloc(0);
  let eof = false;
  const pull = async (): Promise<void> => {
    const r = await it.next();
    if (r.done) eof = true;
    else buf = buf.length ? Buffer.concat([buf, r.value]) : r.value;
  };
  while (buf.length < HEADER_LEN && !eof) await pull();
  if (buf.length < HEADER_LEN) throw new PortError('corrupt', 'This backup file is incomplete.');
  const header = Buffer.from(buf.subarray(0, HEADER_LEN));
  buf = buf.subarray(HEADER_LEN);
  const logN = header[10]!;
  const r = header[11]!;
  const chunkSize = header.readUInt32BE(36);
  if (
    !isEncrypted(header) ||
    header[8] !== VERSION ||
    header[9] !== KDF_SCRYPT ||
    logN < MIN_LOG_N ||
    logN > MAX_LOG_N ||
    r < 1 ||
    r > 8 ||
    header[12] !== 1 ||
    chunkSize < MIN_CHUNK ||
    chunkSize > MAX_CHUNK
  )
    throw new PortError('corrupt', 'This backup uses an unsupported or damaged encryption header.');
  const key = await deriveKey(passphrase, header.subarray(13, 29), logN, r);
  const prefix = header.subarray(29, 36);
  const unit = chunkSize + TAG;
  let counter = 0;
  const open = (sealed: Buffer, last: boolean): Buffer => {
    if (sealed.length < TAG) throw new PortError('corrupt', 'This backup file is incomplete.');
    const d = createDecipheriv('aes-256-gcm', key, nonce(prefix, counter, last));
    d.setAAD(header);
    d.setAuthTag(sealed.subarray(sealed.length - TAG));
    try {
      const out = Buffer.concat([d.update(sealed.subarray(0, sealed.length - TAG)), d.final()]);
      counter++;
      return out;
    } catch {
      throw new PortError(counter === 0 ? 'validation' : 'corrupt', counter === 0 ? WRONG : 'This backup is damaged (a part failed its check).');
    }
  };
  for (;;) {
    while (buf.length <= unit && !eof) await pull();
    if (buf.length > unit) {
      yield open(Buffer.from(buf.subarray(0, unit)), false);
      buf = buf.subarray(unit);
      continue;
    }
    break;
  }
  if (counter === 0 && buf.length === 0) throw new PortError('corrupt', 'This backup file is incomplete.');
  yield open(Buffer.from(buf), true);
}
