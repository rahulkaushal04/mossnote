import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { PairedDevice } from '@shared/types';
import type { Clock } from '../db/types';
import { describeDevice } from './describeDevice';

/**
 * The phones that have been paired, kept in `phone-devices.json` in the data folder so a phone
 * stays paired when Mossnote restarts. Only a hash of each session token is stored: the file
 * alone cannot be used to sign in.
 */

export const MAX_DEVICES = 20;
/** Last-seen times are saved at most this often; they change on every request. */
const SAVE_EVERY_MS = 5 * 60_000;
const TOKEN_BYTES = 32;
const ID_BYTES = 9;

const recordSchema = z.object({
  id: z.string(),
  tokenHash: z.string(),
  name: z.string(),
  pairedAt: z.number(),
  lastSeenAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), devices: z.array(recordSchema) });
type DeviceRecord = z.infer<typeof recordSchema>;

export interface DeviceRegistry {
  /** Pair a new device. When the list is full the device seen least recently is dropped. */
  add(userAgent: string | undefined): { token: string; device: PairedDevice };
  /** The device a session token belongs to. Records that it was just seen. */
  authenticate(token: string): PairedDevice | null;
  list(): PairedDevice[];
  revoke(id: string): boolean;
  revokeAll(): number;
}

export interface DeviceRegistryOptions {
  /** Where to keep the list. Omit to keep it in memory only. */
  file?: string;
  clock: Clock;
  randomBytes: (length: number) => Uint8Array;
}

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const toDevice = (record: DeviceRecord): PairedDevice => ({
  id: record.id,
  name: record.name,
  pairedAt: new Date(record.pairedAt).toISOString(),
  lastSeenAt: new Date(record.lastSeenAt).toISOString(),
});

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function load(file: string | undefined): DeviceRecord[] {
  if (!file) return [];
  try {
    return fileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8'))).devices;
  } catch {
    // Missing or damaged: nobody is paired. Pairing again is the remedy, so do not stop the app.
    return [];
  }
}

function save(file: string | undefined, devices: readonly DeviceRecord[]): void {
  if (!file) return;
  const staged = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(staged, JSON.stringify({ version: 1, devices }), { mode: 0o600 });
  fs.renameSync(staged, file);
}

export function createDeviceRegistry(options: DeviceRegistryOptions): DeviceRegistry {
  const { file, clock, randomBytes } = options;
  let records = load(file);
  let savedAt = clock.now();

  const persist = () => {
    save(file, records);
    savedAt = clock.now();
  };

  return {
    add(userAgent) {
      const now = clock.now();
      const token = Buffer.from(randomBytes(TOKEN_BYTES)).toString('base64url');
      const record: DeviceRecord = {
        id: Buffer.from(randomBytes(ID_BYTES)).toString('base64url'),
        tokenHash: hashToken(token),
        name: describeDevice(userAgent),
        pairedAt: now,
        lastSeenAt: now,
      };
      const newest = [...records].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
      records = [...newest.slice(0, MAX_DEVICES - 1), record];
      persist();
      return { token, device: toDevice(record) };
    },
    authenticate(token) {
      const hash = hashToken(token);
      const index = records.findIndex((record) => sameHash(record.tokenHash, hash));
      const found = records[index];
      if (!found) return null;
      const now = clock.now();
      const seen = { ...found, lastSeenAt: now };
      records = records.map((record, at) => (at === index ? seen : record));
      if (now - savedAt >= SAVE_EVERY_MS) persist();
      return toDevice(seen);
    },
    list() {
      return [...records].sort((a, b) => b.lastSeenAt - a.lastSeenAt).map(toDevice);
    },
    revoke(id) {
      const kept = records.filter((record) => record.id !== id);
      if (kept.length === records.length) return false;
      records = kept;
      persist();
      return true;
    },
    revokeAll() {
      const removed = records.length;
      records = [];
      if (removed > 0) persist();
      return removed;
    },
  };
}
