import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeClock, makeTempDir, removeDir } from '../testing/helpers';
import { createDeviceRegistry, MAX_DEVICES } from './deviceRegistry';

let dir: string;
let file: string;
beforeEach(() => {
  dir = makeTempDir('moss-devices-');
  file = path.join(dir, 'phone-devices.json');
});
afterEach(() => {
  removeDir(dir);
});

function countingBytes() {
  let next = 1;
  return (length: number) => Uint8Array.from({ length }, () => next++ % 256);
}

function setup(withFile = true) {
  const clock = fakeClock();
  const registry = createDeviceRegistry({
    ...(withFile ? { file } : {}),
    clock,
    randomBytes: countingBytes(),
  });
  return { clock, registry };
}

describe('paired devices', () => {
  it('pairs a device and recognises its token', () => {
    const { registry } = setup();

    const { token, device } = registry.add('Mozilla/5.0 (iPhone) Safari');

    expect(device.name).toBe('iPhone (Safari)');
    expect(registry.authenticate(token)?.id).toBe(device.id);
  });

  it('does not recognise a token it never issued', () => {
    const { registry } = setup();
    registry.add(undefined);

    expect(registry.authenticate('not-a-token')).toBeNull();
    expect(registry.authenticate('')).toBeNull();
  });

  it('records when a device was last seen', () => {
    const { clock, registry } = setup();
    const { token } = registry.add(undefined);

    clock.advance(3_600_000);
    const seen = registry.authenticate(token);

    expect(seen && Date.parse(seen.lastSeenAt) - Date.parse(seen.pairedAt)).toBe(3_600_000);
  });

  it('removes one device, and only that one', () => {
    const { registry } = setup();
    const first = registry.add(undefined);
    const second = registry.add(undefined);

    expect(registry.revoke(first.device.id)).toBe(true);

    expect(registry.authenticate(first.token)).toBeNull();
    expect(registry.authenticate(second.token)).not.toBeNull();
    expect(registry.revoke(first.device.id)).toBe(false);
  });

  it('removes every device', () => {
    const { registry } = setup();
    const { token } = registry.add(undefined);
    registry.add(undefined);

    expect(registry.revokeAll()).toBe(2);

    expect(registry.list()).toEqual([]);
    expect(registry.authenticate(token)).toBeNull();
  });

  it('drops the device seen least recently when the list is full', () => {
    const { clock, registry } = setup();
    const oldest = registry.add(undefined);
    for (let n = 1; n < MAX_DEVICES; n++) {
      clock.advance(1_000);
      registry.add(undefined);
    }
    clock.advance(1_000);

    const newest = registry.add(undefined);

    expect(registry.list()).toHaveLength(MAX_DEVICES);
    expect(registry.authenticate(oldest.token)).toBeNull();
    expect(registry.authenticate(newest.token)).not.toBeNull();
  });
});

describe('the devices file', () => {
  it('keeps devices paired across a restart', () => {
    const { token } = setup().registry.add(undefined);

    const restarted = setup().registry;

    expect(restarted.authenticate(token)).not.toBeNull();
  });

  it('stores a hash of the token, never the token', () => {
    const { token } = setup().registry.add(undefined);

    expect(fs.readFileSync(file, 'utf8')).not.toContain(token);
  });

  it('keeps nothing on disk when no file is given', () => {
    const { registry } = setup(false);

    registry.add(undefined);

    expect(fs.existsSync(file)).toBe(false);
  });

  it('starts with nobody paired when the file is damaged', () => {
    fs.writeFileSync(file, '{ not json');

    expect(setup().registry.list()).toEqual([]);
  });
});
