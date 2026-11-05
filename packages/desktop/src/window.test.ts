import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CSP as UI_CSP } from '@mossnote/ui/csp';
import { describe, expect, it, vi } from 'vitest';

type Wc = {
  handlers: Map<string, (e: { preventDefault(): void }) => void>;
  openHandler?: () => { action: string };
};
const created: { opts: Record<string, unknown>; loaded: unknown[]; webContents: Wc }[] = [];
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = {
      handlers: new Map<string, (e: { preventDefault(): void }) => void>(),
      openHandler: undefined as (() => { action: string }) | undefined,
      on(name: string, f: never) {
        this.handlers.set(name, f);
      },
      setWindowOpenHandler(f: never) {
        this.openHandler = f;
      },
    };
    loaded: unknown[] = [];
    constructor(public opts: Record<string, unknown>) {
      created.push(this);
    }
    loadFile(...a: unknown[]) {
      this.loaded.push(a);
      return Promise.resolve();
    }
    maximize() {}
    on() {}
    getNormalBounds() {
      return {};
    }
    isMaximized() {
      return false;
    }
  },
}));

const {
  CSP,
  createAppWindow,
  getWebPreferences,
  hardenWebContents,
  installSessionGuards,
  isAllowedUrl,
} = await import('./window.ts');

const dist = '/app/packages/ui/dist';

describe('AS-13 web preferences', () => {
  it('hardens the renderer', () => {
    const p = getWebPreferences('/x/preload.cjs');
    expect(p).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    });
  });
});

describe('AS-13 CSP', () => {
  it('is the ui constant and blocks remote content', () => {
    expect(CSP).toBe(UI_CSP);
    expect(CSP).toContain("default-src 'none'");
    expect(CSP).toContain("connect-src 'none'");
    expect(CSP).not.toMatch(/https?:|\*|unsafe-eval/);
  });
  it('is sent as a header by the session guard', () => {
    const { ses, hooks } = fakeSession();
    installSessionGuards(ses, dist);
    let out: { responseHeaders: Record<string, string[]> } | undefined;
    hooks.headers?.({ responseHeaders: { X: ['1'] } }, (r: typeof out) => (out = r));
    expect(out?.responseHeaders['Content-Security-Policy']).toEqual([UI_CSP]);
    expect(out?.responseHeaders.X).toEqual(['1']);
  });
});

const SHA = 'a'.repeat(64);
const attach = `mossnote-attachment://a/${SHA}`;

function fakeSession() {
  const hooks: Record<string, (...a: never[]) => void> = {};
  let perm: ((...a: unknown[]) => void) | undefined;
  let check: (() => boolean) | undefined;
  const ses = {
    webRequest: {
      onBeforeRequest: (f: never) => (hooks.request = f),
      onHeadersReceived: (f: never) => (hooks.headers = f),
    },
    on: (ev: string, f: never) => (hooks[ev] = f),
    setPermissionRequestHandler: (f: never) => (perm = f),
    setPermissionCheckHandler: (f: never) => (check = f),
  } as never;
  return {
    ses,
    hooks: hooks as Record<string, (...a: unknown[]) => void>,
    perm: () => perm,
    check: () => check,
  };
}

describe('AT-4/AT-5 attachment scheme in the session guard', () => {
  it('allows only the exact attachment URL; every other request stays cancelled and counted', () => {
    expect(isAllowedUrl(attach, dist)).toBe(true);
    for (const u of [
      `${attach}?x=1`,
      `${attach}#f`,
      `${attach}/`,
      `${attach}/../x`,
      `mossnote-attachment://b/${SHA}`,
      `mossnote-attachment://a/${SHA.toUpperCase()}`,
      `mossnote-attachment://a/${'a'.repeat(63)}`,
      `mossnote-attachment://a/${'a'.repeat(65)}`,
      `mossnote-attachment://evil@a/${SHA}`,
      `mossnote-attachment:///${SHA}`,
      `mossnote-attachments://a/${SHA}`,
      `https://a/${SHA}`,
    ])
      expect(isAllowedUrl(u, dist), u).toBe(false);
    const g = globalThis as { __blockedRequests?: number };
    g.__blockedRequests = 0;
    const s = fakeSession();
    installSessionGuards(s.ses, dist, true);
    const cancelled = (url: string) => {
      let r: { cancel: boolean } | undefined;
      s.hooks.request?.({ url }, (x: typeof r) => (r = x));
      return r?.cancel;
    };
    expect(cancelled(attach)).toBe(false);
    expect(cancelled('https://example.com/')).toBe(true);
    expect(cancelled(`${attach}x`)).toBe(true);
    expect(g.__blockedRequests).toBe(2);
    delete g.__blockedRequests;
  });
  it('the app CSP header is unchanged and the attachment response keeps its own policy', () => {
    const { ses, hooks } = fakeSession();
    installSessionGuards(ses, dist);
    const run = (url: string, headers: Record<string, string[]>) => {
      let out: { responseHeaders: Record<string, string[]> } | undefined;
      hooks.headers?.({ url, responseHeaders: headers }, (r: typeof out) => (out = r));
      return out?.responseHeaders;
    };
    expect(run('file:///app/ui/dist/index.html', {})?.['Content-Security-Policy']).toEqual([UI_CSP]);
    const own = { 'Content-Security-Policy': ["sandbox; default-src 'none'"] };
    expect(run(attach, own)).toEqual(own);
  });
  it('cancels downloads', () => {
    const { ses, hooks } = fakeSession();
    installSessionGuards(ses, dist);
    let p = 0;
    hooks['will-download']?.({ preventDefault: () => p++ });
    expect(p).toBe(1);
  });
  it('the capture window preload is told it is the capture window', () => {
    expect(getWebPreferences('/p.cjs', false, 'capture').additionalArguments).toEqual([
      '--mossnote-capture',
    ]);
    expect(getWebPreferences('/p.cjs', true, 'capture').additionalArguments).toEqual([
      '--mossnote-e2e',
      '--mossnote-capture',
    ]);
    expect(getWebPreferences('/p.cjs', false, 'main').additionalArguments).toBeUndefined();
  });
});

describe('AS-13 isAllowedUrl', () => {
  const idx = pathToFileURL(path.join(dist, 'index.html')).href;
  it.each([
    [idx, true],
    [`${idx}#capture`, true],
    [`${idx}?x=1`, true],
    [pathToFileURL(path.join(dist, 'assets/a.js')).href, true],
    ['devtools://devtools/bundled/x.html', false], // only for e2e runs (see below)
    ['https://example.com/', false],
    ['http://localhost:5173/', false],
    ['ws://x/', false],
    ['data:text/html,hi', false],
    ['file:///etc/passwd', false],
    [pathToFileURL('/app/packages/ui/dist-evil/index.html').href, false],
    [`file:///app/packages/ui/dist/../../secret`, false],
    ['file://server/share/index.html', false],
    [dist, false],
    ['not a url', false],
    ['', false],
  ])('%s -> %s', (u, ok) => {
    expect(isAllowedUrl(u, dist)).toBe(ok);
  });
});

describe('AS-13 e2e-only allowances', () => {
  it('devtools URLs and the blocked-request counter exist only when e2e is on', () => {
    const g = globalThis as { __blockedRequests?: number };
    expect(isAllowedUrl('devtools://devtools/x', dist)).toBe(false);
    expect(isAllowedUrl('devtools://devtools/x', dist, true)).toBe(true);
    delete g.__blockedRequests;
    const plain = fakeSession();
    installSessionGuards(plain.ses, dist);
    plain.hooks.request?.({ url: 'https://example.com/' }, () => {});
    expect(g.__blockedRequests).toBeUndefined();
    const e2e = fakeSession();
    installSessionGuards(e2e.ses, dist, true);
    e2e.hooks.request?.({ url: 'https://example.com/' }, () => {});
    expect(g.__blockedRequests).toBe(1);
    delete g.__blockedRequests;
  });
  it('web preferences carry the e2e argument for the preload only when asked', () => {
    expect(getWebPreferences('/p.cjs').additionalArguments).toBeUndefined();
    expect(getWebPreferences('/p.cjs', true).additionalArguments).toEqual(['--mossnote-e2e']);
  });
});

describe('AS-13 hardening', () => {
  it('prevents navigation and redirects and denies windows', () => {
    const on = new Map<string, (e: { preventDefault(): void }) => void>();
    let open: (() => { action: string }) | undefined;
    hardenWebContents({
      on: ((n: string, f: never) => on.set(n, f)) as never,
      setWindowOpenHandler: ((f: never) => (open = f)) as never,
    });
    for (const n of ['will-navigate', 'will-redirect']) {
      let p = 0;
      on.get(n)?.({ preventDefault: () => p++ });
      expect(p, n).toBe(1);
    }
    expect(open?.()).toEqual({ action: 'deny' });
  });

  it('cancels non-local requests, counts them, denies permissions', () => {
    const g = globalThis as { __blockedRequests?: number };
    g.__blockedRequests = 0;
    const s = fakeSession();
    installSessionGuards(s.ses, dist, true); // counting is an e2e-only feature
    const run = (url: string) => {
      let r: { cancel: boolean } | undefined;
      s.hooks.request?.({ url }, (x: typeof r) => (r = x));
      return r?.cancel;
    };
    expect(run(pathToFileURL(path.join(dist, 'index.html')).href)).toBe(false);
    expect(run('https://example.com/x.png')).toBe(true);
    expect(run('file:///etc/hosts')).toBe(true);
    expect(g.__blockedRequests).toBe(2);
    let granted: boolean | undefined;
    s.perm()?.(null, 'geolocation', (v: boolean) => (granted = v));
    expect(granted).toBe(false);
    expect(s.check()?.()).toBe(false);
  });
});

describe('AS-13 windows', () => {
  const o = {
    preload: '/p.cjs',
    uiIndex: '/ui/index.html',
    stateFile: '/nonexistent/ws.json',
    screen: {
      getAllDisplays: () => [
        { primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      ],
      on() {},
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
  };
  it('creates a hardened 480x240 capture window loading #capture', () => {
    createAppWindow('capture', o as never);
    const w = created.at(-1);
    expect(w?.opts).toMatchObject({ width: 480, height: 240 });
    expect((w?.opts.webPreferences as { sandbox: boolean }).sandbox).toBe(true);
    expect(w?.loaded).toEqual([['/ui/index.html', { hash: 'capture' }]]);
  });
  it.each(['main', 'capture'] as const)(
    "createAppWindow hardens the %s window's webContents",
    (kind) => {
      createAppWindow(kind, o as never);
      const wc = created.at(-1)!.webContents;
      for (const n of ['will-navigate', 'will-redirect']) {
        let prevented = 0;
        wc.handlers.get(n)?.({ preventDefault: () => prevented++ });
        expect(prevented, `${kind} ${n}`).toBe(1);
      }
      expect(wc.openHandler?.()).toEqual({ action: 'deny' });
    },
  );
  it('creates the main window with default bounds when no state exists', () => {
    createAppWindow('main', o as never);
    expect(created.at(-1)?.opts).toMatchObject({ width: 1000, height: 700, x: 460, y: 190 });
  });
  it('new BrowserWindow( appears only in window.ts', () => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const hits = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => fs.readFileSync(path.join(dir, f), 'utf8').includes('new BrowserWindow('));
    expect(hits).toEqual(['window.ts']);
  });
});
