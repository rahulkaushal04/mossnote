/**
 * The `.mossbak` package: one ustar file with a fixed entry set, in this order (decisions M6/C2):
 *   mossnote.db                      consistent snapshot (SQLite online backup)
 *   attachments/<sha256> ...         strictly ascending
 *   mossnote-backup.json             manifest (written last: it records what was actually hashed while writing)
 *   mossnote-backup.sha256           trailer: "<sha256 of the manifest bytes> <manifest size>\n"
 * Hash-while-writing is why the manifest comes after the data: a blob that fails its own name is recorded
 * as `damaged` and the package is still written (C2).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { corrupt, PortError, throwIfAborted } from './errors.ts';
import { readTar, type TarSink } from './tar.ts';

export const DB_ENTRY = 'mossnote.db';
export const MANIFEST_ENTRY = 'mossnote-backup.json';
export const TRAILER_ENTRY = 'mossnote-backup.sha256';
export const ATT_PREFIX = 'attachments/';
export const MAX_MANIFEST = 64 * 1024 * 1024;
const MAX_ATTACHMENTS = 1_000_000;
const sha = z.string().regex(/^[0-9a-f]{64}$/);

export const manifestSchema = z
  .object({
    format: z.literal('mossnote-backup'),
    version: z.literal(1),
    kind: z.enum(['auto', 'manual']),
    createdAt: z.string().max(40),
    appVersion: z.string().max(64),
    schemaVersion: z.number().int().min(1).max(10_000),
    workspaceId: z.string().max(64),
    sourceDeviceId: z.string().max(64),
    noteCount: z.number().int().min(0),
    folderCount: z.number().int().min(0),
    db: z.object({ size: z.number().int().min(0), sha256: sha }).strict(),
    attachments: z
      .array(z.object({ sha256: sha, size: z.number().int().min(0) }).strict())
      .max(MAX_ATTACHMENTS),
    /** Blobs that failed their own hash while being written. `missing` ones have no entry in the package. */
    damaged: z
      .array(z.object({ sha256: sha, reason: z.enum(['missing', 'corrupt']) }).strict())
      .max(MAX_ATTACHMENTS),
  })
  .strict();
export type Manifest = z.infer<typeof manifestSchema>;

export interface ReadSinks {
  /** Receives the database bytes; undefined discards them (verify only). */
  db?: () => TarSink;
  blob?: (sha256: string, size: number) => TarSink;
}
export interface ReadLimits {
  /** Newest schema version this app can open. */
  maxSchema: number;
  /** Largest total of entry bytes (free-space check); Infinity when unknown. */
  maxTotal: number;
  signal?: AbortSignal;
}
export interface ReadResult {
  manifest: Manifest;
  dbSha: string;
  /** Computed (not claimed) hashes of the blob entries that exist. */
  blobs: Map<string, { sha256: string; size: number }>;
}

const sorted = <T extends { sha256: string }>(a: T[]): boolean =>
  a.every((x, i) => i === 0 || a[i - 1]!.sha256 < x.sha256);

/** Streams a plaintext package, hashing everything and enforcing the fixed layout. */
export async function readPackage(
  src: AsyncIterable<Buffer>,
  sinks: ReadSinks,
  limits: ReadLimits,
): Promise<ReadResult> {
  let stage: 0 | 1 | 2 | 3 = 0;
  let lastBlob = '';
  let total = 0;
  let dbSha = '';
  let dbSize = -1;
  const blobs = new Map<string, { sha256: string; size: number }>();
  const manifestParts: Buffer[] = [];
  let trailer = '';

  const counting = (inner: TarSink | undefined, done: (sha256: string, size: number) => void): TarSink => {
    const h = createHash('sha256');
    let n = 0;
    return {
      write(c) {
        throwIfAborted(limits.signal);
        h.update(c);
        n += c.length;
        return inner?.write(c);
      },
      async end() {
        await inner?.end();
        done(h.digest('hex'), n);
      },
      abort: () => inner?.abort?.(),
    };
  };

  await readTar(
    src,
    ({ name, size }, index) => {
      total += size;
      if (total > limits.maxTotal)
        throw new PortError('io', 'Not enough disk space to check this backup.');
      if (index === 0) {
        if (name !== DB_ENTRY) throw corrupt();
        stage = 1;
        return counting(sinks.db?.(), (s, n) => {
          dbSha = s;
          dbSize = n;
        });
      }
      if (name.startsWith(ATT_PREFIX)) {
        const hex = name.slice(ATT_PREFIX.length);
        if (stage !== 1 || !/^[0-9a-f]{64}$/.test(hex) || hex <= lastBlob) throw corrupt();
        lastBlob = hex;
        return counting(sinks.blob?.(hex, size), (s, n) => blobs.set(hex, { sha256: s, size: n }));
      }
      if (name === MANIFEST_ENTRY && stage === 1) {
        if (size > MAX_MANIFEST) throw corrupt();
        stage = 2;
        return {
          write: (c) => void manifestParts.push(Buffer.from(c)),
          end: () => undefined,
        };
      }
      if (name === TRAILER_ENTRY && stage === 2) {
        if (size > 200) throw corrupt();
        stage = 3;
        const parts: Buffer[] = [];
        return {
          write: (c) => void parts.push(Buffer.from(c)),
          end: () => void (trailer = Buffer.concat(parts).toString('latin1')),
        };
      }
      throw corrupt();
    },
    { maxEntries: MAX_ATTACHMENTS + 3 },
  );
  if ((stage as number) !== 3) throw corrupt('This backup file is incomplete.');

  const mbytes = Buffer.concat(manifestParts);
  const t = /^([0-9a-f]{64}) (\d+)\n$/.exec(trailer);
  if (!t || t[1] !== createHash('sha256').update(mbytes).digest('hex') || Number(t[2]) !== mbytes.length)
    throw corrupt('This backup failed its checksum.');
  let parsed: Manifest;
  try {
    const p = manifestSchema.safeParse(JSON.parse(mbytes.toString('utf8')));
    if (!p.success) throw corrupt();
    parsed = p.data;
  } catch (e) {
    throw e instanceof PortError ? e : corrupt();
  }
  if (parsed.schemaVersion > limits.maxSchema)
    throw new PortError('unavailable', 'This backup was created by a newer Mossnote. Update the app to restore it.');
  if (parsed.db.sha256 !== dbSha || parsed.db.size !== dbSize) throw corrupt('This backup failed its checksum.');
  if (!sorted(parsed.attachments) || !sorted(parsed.damaged)) throw corrupt();
  const damaged = new Map(parsed.damaged.map((d) => [d.sha256, d.reason]));
  // Entry set = intact attachments + damaged-but-present ones; every intact entry must hash to its name.
  const expected = new Set(parsed.attachments.map((a) => a.sha256));
  for (const [s, r] of damaged) {
    if (expected.has(s)) throw corrupt();
    if (r === 'corrupt') expected.add(s);
  }
  if (expected.size !== blobs.size) throw corrupt('This backup is missing files.');
  for (const a of parsed.attachments) {
    const got = blobs.get(a.sha256);
    if (!got || got.sha256 !== a.sha256 || got.size !== a.size)
      throw corrupt('An attachment in this backup failed its checksum.');
  }
  for (const s of expected) if (!blobs.has(s)) throw corrupt('This backup is missing files.');
  return { manifest: parsed, dbSha, blobs };
}
