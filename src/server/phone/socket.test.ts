import net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { createFolderStorage } from '../db/folderStorage';
import { ALL_INTERFACES, startListener, type Listener } from '../listener';
import { fakeClock, migratedMemoryDatabase } from '../testing/helpers';
import { testConfig } from '../testing/app';
import { createPhoneAccess } from '.';

/** The real server on a real socket, to prove the sender's address is read from the connection. */

let listener: Listener | undefined;
afterEach(async () => {
  await listener?.close();
  listener = undefined;
});

let port: number;
beforeEach(async () => {
  port = await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const found = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => {
        resolve(found);
      });
    });
  });
});

async function serve(host: string) {
  const database = await migratedMemoryDatabase();
  const config = testConfig({ port });
  const phone = createPhoneAccess({
    port,
    clock: fakeClock(),
    enabled: true,
    network: { interfaces: () => ({}), hostname: () => 'laptop' },
  });
  const app = createApp({
    db: database.db,
    sqlite: database.sqlite,
    storage: createFolderStorage(config),
    clock: fakeClock(),
    config,
    phone,
  });
  listener = await startListener({ app, host, port });
}

describe('phone access over a real connection', () => {
  it('recognises the computer itself over loopback, without a pairing', async () => {
    await serve(ALL_INTERFACES);

    const res = await fetch(`http://127.0.0.1:${port}/api/phone`);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { enabled: boolean }).enabled).toBe(true);
  });

  it('recognises the computer itself by the name localhost', async () => {
    await serve(ALL_INTERFACES);

    const res = await fetch(`http://localhost:${port}/api/health`);

    expect(res.status).toBe(200);
  });
});
