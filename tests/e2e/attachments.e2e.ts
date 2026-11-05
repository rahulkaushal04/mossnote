// USER-RUN (Electron cannot start in the build sandbox). AT-1, AT-4, AT-5, AT-10, AS-13 for attachments.
// Native dialogs and the clipboard are stubbed from the test through app.evaluate; main looks them up at call time.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CSP_META } from '../../packages/ui/src/csp.ts';
import { launch, newDataDir } from './launch.ts';

// A valid 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const SHA = createHash('sha256').update(PNG).digest('hex');
const urlOf = (sha: string) => `mossnote-attachment://a/${sha}`;

type Api = {
  rpc(m: string, a?: unknown): Promise<{ ok: boolean; value?: any; error?: { code: string } }>;
  native: {
    pickFile(): Promise<string | undefined>;
    dropTokens(f: File[]): Promise<string[]>;
    pasteImage(id: string): Promise<{ ok: boolean; value?: any; error?: { code: string } }>;
    loadRemoteImage(u: string): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  };
};
// Page-side accessor: evaluate() callbacks are serialized, so each one must call this inline.
type W = { mossnote: Api };

async function attachPng(app: ElectronApplication, win: Page, dataDir: string) {
  const file = path.join(dataDir, 'pic.png');
  fs.writeFileSync(file, PNG);
  await app.evaluate(({ dialog }, f) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [f] })) as never;
  }, file);
  return win.evaluate(async () => {
    const m = (window as unknown as W).mossnote;
    const note = await m.rpc('notes.create', { body: '# a' });
    const token = await m.native.pickFile();
    const added = await m.rpc('attachments.addPath', { noteId: note.value.id, token });
    const again = await m.rpc('attachments.addPath', { noteId: note.value.id, token }); // single use
    return { noteId: note.value.id as string, token, added, again };
  });
}

const fetchInMain = (app: ElectronApplication, url: string, range?: string) =>
  app.evaluate(
    async ({ session }, a) => {
      const r = await session.defaultSession.fetch(a.url, a.range ? { headers: { Range: a.range } } : {});
      return {
        status: r.status,
        type: r.headers.get('content-type'),
        csp: r.headers.get('content-security-policy'),
        nosniff: r.headers.get('x-content-type-options'),
        length: (await r.arrayBuffer()).byteLength,
      };
    },
    { url, range },
  );

test('pick -> attach -> the protocol serves the image; tokens are single use', async () => {
  const dir = newDataDir();
  const { app, win } = await launch(dir);
  try {
    const r = await attachPng(app, win, dir);
    expect(r.added.ok).toBe(true);
    expect(r.added.value.sha256).toBe(SHA);
    expect(r.again.ok).toBe(false);
    const full = await fetchInMain(app, urlOf(SHA));
    expect(full).toMatchObject({ status: 200, type: 'image/png', nosniff: 'nosniff', length: PNG.length });
    expect(full.csp).toBe("sandbox; default-src 'none'");
    expect((await fetchInMain(app, urlOf(SHA), 'bytes=0-3')).status).toBe(206);
    expect((await fetchInMain(app, urlOf(SHA), `bytes=${PNG.length + 5}-`)).status).toBe(416);
    expect((await fetchInMain(app, urlOf('0'.repeat(64)))).status).toBe(404);
    // The page can show it: img-src names the scheme, and it is not counted as a blocked request.
    const shown = await win.evaluate(
      (u) =>
        new Promise<number>((res) => {
          const i = new Image();
          i.onload = () => res(i.naturalWidth);
          i.onerror = () => res(-1);
          i.src = u;
        }),
      urlOf(SHA),
    );
    expect(shown).toBe(1);
    expect(
      await app.evaluate(() => (globalThis as { __blockedRequests?: number }).__blockedRequests),
    ).toBe(0);
  } finally {
    await app.close();
  }
});

test('a tampered file is refused with 409 and never served', async () => {
  const dir = newDataDir();
  const { app, win } = await launch(dir);
  try {
    await attachPng(app, win, dir);
    expect((await fetchInMain(app, urlOf(SHA))).status).toBe(200);
    const blob = path.join(dir, 'workspace', 'attachments', SHA.slice(0, 2), SHA.slice(2, 4), SHA);
    const bad = Buffer.from(PNG);
    bad[bad.length - 5] ^= 0xff; // same size, different bytes
    fs.chmodSync(blob, 0o644);
    fs.writeFileSync(blob, bad);
    const r = await fetchInMain(app, urlOf(SHA));
    expect(r.status).toBe(409);
    expect(r.length).toBe(0);
  } finally {
    await app.close();
  }
});

test('paste stores the clipboard image; a forged drop yields no token', async () => {
  const dir = newDataDir();
  const { app, win } = await launch(dir);
  try {
    await app.evaluate(({ clipboard }, b64) => {
      const bytes = Buffer.from(b64, 'base64');
      clipboard.read = (async () => [
        { types: ['image/png'], getType: async () => new Blob([bytes], { type: 'image/png' }) },
      ]) as never;
    }, PNG.toString('base64'));
    const r = await win.evaluate(async () => {
      const m = (window as unknown as W).mossnote;
      const note = await m.rpc('notes.create', { body: '# p' });
      const pasted = await m.native.pasteImage(note.value.id);
      // A File built by the page has no path on disk: the preload finds none and nothing is registered.
      const tokens = await m.native.dropTokens([new File(['x'], '/etc/passwd')]);
      return { pasted, tokens };
    });
    expect(r.pasted.ok).toBe(true);
    expect(r.pasted.value.name).toBe('Pasted image.png');
    expect(r.pasted.value.sha256).toBe(SHA);
    expect(r.tokens).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the app page policy is unchanged and takes no remote or eval sources', async () => {
  const { app, win } = await launch(newDataDir());
  try {
    const meta = await win
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(meta).toBe(CSP_META);
    expect(meta).not.toMatch(/https?:|\*|unsafe-eval/);
    expect(meta).toContain("connect-src 'none'");
  } finally {
    await app.close();
  }
});

test('loading a remote image asks first, naming the host; declining fetches nothing', async () => {
  const { app, win } = await launch(newDataDir(), ['--host-resolver-rules=MAP * ~NOTFOUND']);
  try {
    await app.evaluate(({ dialog }) => {
      const g = globalThis as { __confirm?: { message: string } };
      dialog.showMessageBox = (async (...a: unknown[]) => {
        g.__confirm = a.find((x) => x && typeof x === 'object' && 'message' in x) as never;
        return { response: 0, checkboxChecked: false };
      }) as never;
    });
    const r = await win.evaluate(() =>
      (window as unknown as W).mossnote.native.loadRemoteImage('https://img.example.com/a.png'),
    );
    expect(r.ok).toBe(false);
    const shown = await app.evaluate(
      () => (globalThis as { __confirm?: { message: string } }).__confirm?.message,
    );
    expect(shown).toContain('img.example.com');
    // Refused before any dialog: http, private literal.
    for (const u of ['http://img.example.com/a.png', 'https://127.0.0.1/a.png'])
      expect((
          await win.evaluate(
            (x) => (window as unknown as W).mossnote.native.loadRemoteImage(x),
            u,
          )
        ).error?.code).toBe('validation');
  } finally {
    await app.close();
  }
});
