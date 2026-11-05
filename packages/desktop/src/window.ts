import { BrowserWindow, type Session, type WebContents, type WebPreferences } from 'electron';
import { parseAttachmentUrl } from '@mossnote/core';
import { CSP } from '@mossnote/ui/csp';
import { fileURLToPath } from 'node:url';
import { CAPTURE_ARG, E2E_ARG } from './ipc.ts';
import path from 'node:path';
import {
  clampBounds,
  loadWindowState,
  trackWindowState,
  type Display,
  type ScreenLike,
} from './windowState.ts';

export { CSP };
export type WindowKind = 'main' | 'capture';

export function getWebPreferences(
  preload: string,
  e2e = false,
  kind: WindowKind = 'main',
): WebPreferences {
  const args = [...(e2e ? [E2E_ARG] : []), ...(kind === 'capture' ? [CAPTURE_ARG] : [])];
  return {
    ...(args.length ? { additionalArguments: args } : {}),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    webviewTag: false,
    preload,
  };
}

/**
 * True when `url` is a local file inside `uiDist` (query and hash ignored) or an exact attachment URL
 * (`mossnote-attachment://a/<hex64>`, served hash-verified by main); devtools only for e2e runs.
 */
export function isAllowedUrl(url: string, uiDist: string, allowDevtools = false): boolean {
  if (parseAttachmentUrl(url) !== undefined) return true;
  try {
    const u = new URL(url);
    if (u.protocol === 'devtools:') return allowDevtools;
    if (u.protocol !== 'file:' || u.host !== '') return false;
    const rel = path.relative(path.resolve(uiDist), path.resolve(fileURLToPath(u)));
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

/** Blocks every navigation, redirect and popup. The app never leaves its one page. */
export function hardenWebContents(wc: Pick<WebContents, 'on' | 'setWindowOpenHandler'>): void {
  const block = (e: { preventDefault(): void }) => e.preventDefault();
  wc.on('will-navigate', block);
  wc.on('will-redirect', block);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

type G = typeof globalThis & { __blockedRequests?: number };

/** Session-wide guards: cancel non-local requests (counted when `e2e`), deny permissions and downloads, send the CSP. */
export function installSessionGuards(ses: Session, uiDist: string, e2e = false): void {
  if (e2e) (globalThis as G).__blockedRequests ??= 0;
  ses.webRequest.onBeforeRequest((details, cb) => {
    const ok = isAllowedUrl(details.url, uiDist, e2e);
    if (!ok && e2e)
      (globalThis as G).__blockedRequests = ((globalThis as G).__blockedRequests ?? 0) + 1;
    cb({ cancel: !ok });
  });
  ses.webRequest.onHeadersReceived((details, cb) => {
    // Attachment responses carry their own restrictive policy (sandbox; default-src 'none'): leave it alone.
    if (parseAttachmentUrl(details.url) !== undefined) return cb({ responseHeaders: details.responseHeaders });
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  ses.on('will-download', (e) => e.preventDefault()); // nothing is ever saved or opened without the user's dialog
  ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  ses.setPermissionCheckHandler(() => false);
}

export interface AppWindowOptions {
  preload: string;
  uiIndex: string;
  screen: ScreenLike & { getPrimaryDisplay(): Display };
  /** Where the main window's bounds are kept. */
  stateFile: string;
  /** MOSSNOTE_E2E=1: the preload exposes the smoke probes. */
  e2e?: boolean;
}

/** The only place a BrowserWindow is constructed (AS-13). */
export function createAppWindow(kind: WindowKind, o: AppWindowOptions): BrowserWindow {
  const webPreferences = getWebPreferences(o.preload, o.e2e, kind);
  let win: BrowserWindow;
  if (kind === 'capture') {
    win = new BrowserWindow({
      width: 480,
      height: 240,
      minWidth: 320,
      minHeight: 200,
      title: 'Quick capture',
      webPreferences,
    });
  } else {
    const displays = o.screen.getAllDisplays();
    const b = clampBounds(loadWindowState(o.stateFile), displays);
    win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      minWidth: 640,
      minHeight: 400,
      webPreferences,
    });
    if (b.maximized) win.maximize();
    trackWindowState(win, o.screen, o.stateFile);
  }
  hardenWebContents(win.webContents);
  void win.loadFile(o.uiIndex, kind === 'capture' ? { hash: 'capture' } : undefined);
  return win;
}
