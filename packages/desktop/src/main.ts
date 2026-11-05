import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  protocol,
  screen,
  session,
  shell,
  utilityProcess,
} from 'electron';
import Database from 'better-sqlite3';
import { ATTACHMENT_SCHEME, openWorkspace } from '@mossnote/core';
import { CAPTURE_METHODS, createDispatcher } from '@mossnote/core/rpc';
import { commands } from '@mossnote/ui/commands';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ATTACHMENT_PRIVILEGES, createAttachmentHandler } from './attachmentsProtocol.ts';
import { createCapture } from './capture.ts';
import { copyOut } from './copyOut.ts';
import { CHANNELS, forwardEvents, isOurPage, registerRpc } from './ipc.ts';
import { createLifecycle } from './lifecycle.ts';
import { buildMenuTemplate } from './menu.ts';
import { registerNative } from './native.ts';
import { createUtilityExtractor } from './pdfUtility.ts';
import { loadRemoteImage, nodeRemoteDeps } from './remoteImage.ts';
import { createUploadTokens } from './uploadTokens.ts';
import { createAppWindow, installSessionGuards, type WindowKind } from './window.ts';

function fts5Probe(): boolean {
  const db = new Database(':memory:');
  try {
    db.exec('create virtual table t using fts5(body)');
    db.exec("insert into t(body) values ('hello mossnote')");
    return db.prepare("select rowid from t where t match 'mossnote'").all().length === 1;
  } finally {
    db.close();
  }
}

// Must run before app ready. Not bypassCSP: the app page CSP still has to name the scheme (img-src, media-src).
protocol.registerSchemesAsPrivileged([
  { scheme: ATTACHMENT_PRIVILEGES.scheme, privileges: { ...ATTACHMENT_PRIVILEGES.privileges } },
]);

// MOSSNOTE_DATA_DIR relocates all app data (db, window state, single-instance lock) for e2e runs.
if (process.env.MOSSNOTE_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.MOSSNOTE_DATA_DIR));

const uiIndex = path.join(__dirname, '../../ui/dist/index.html');
const uiDist = path.dirname(uiIndex);
const preload = path.join(__dirname, 'preload.cjs');
// e2e runs only: smoke probes in the preload, blocked-request counter, devtools URLs.
const e2e = process.env.MOSSNOTE_E2E === '1';

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void start();
}

async function start(): Promise<void> {
  const kinds = new Map<number, WindowKind>();
  let mainWin: BrowserWindow | null = null;
  const live = () => (mainWin && !mainWin.isDestroyed() ? mainWin : null);

  const dbDir = path.join(app.getPath('userData'), 'workspace');
  fs.mkdirSync(dbDir, { recursive: true });

  const lifecycle = createLifecycle({
    platform: process.platform,
    newToken: randomUUID,
    hasWindow: () => live() !== null,
    sendFlushRequest: (token) =>
      live()?.webContents.send(CHANNELS.event, { type: 'flushRequest', token }),
    hasCapture: () => capture.isOpen(),
    sendCaptureFlush: (token) => capture.notify(CHANNELS.event, { type: 'flushRequest', token }),
    closeWindow: () => live()?.close(),
    quit: () => app.quit(),
    closeDispatcher: () => void dispatcher.close(),
    // M11: let a running cleanup or verify finish (bounded) before the workspace closes.
    drain: () => (wsr.ok ? wsr.value.attachments.idle() : Promise.resolve()),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => clearTimeout(t as NodeJS.Timeout),
  });
  // The lock is taken at open; a locked or corrupt workspace is reported to the renderer by app.status.
  const tokens = createUploadTokens({ newToken: randomUUID });
  // The core opens the attachments root and sweeps leftover temp files of interrupted adds.
  const wsr = openWorkspace(path.join(dbDir, 'mossnote.db'), {
    attachments: {
      pdf: createUtilityExtractor({
        fork: (entry, args, o) => utilityProcess.fork(entry, args, o),
        entry: path.join(__dirname, 'pdfChild.cjs'),
      }),
    },
  });
  const dispatcher = createDispatcher(wsr, {
    platform: process.platform,
    resolveUploadPath: (token) => tokens.resolve(token),
    onFlushed: (token) => void lifecycle.ack(token),
    onQuit: () => app.quit(), // before-quit runs the lifecycle flush handshake
    onOpenCapture: () => capture.open(),
  });

  const winOpts = () => ({
    preload,
    uiIndex,
    screen,
    e2e,
    stateFile: path.join(app.getPath('userData'), 'window-state.json'),
  });
  const track = (win: BrowserWindow, kind: WindowKind) => {
    const id = win.webContents.id;
    kinds.set(id, kind);
    win.on('closed', () => kinds.delete(id));
  };

  function createMain(): void {
    const win = createAppWindow('main', winOpts());
    mainWin = win;
    track(win, 'main');
    win.on('close', (e) => lifecycle.onWindowClose(e));
    win.on('closed', () => {
      if (mainWin === win) mainWin = null;
    });
  }

  const capture = createCapture({
    create: () => {
      const win = createAppWindow('capture', winOpts());
      track(win, 'capture');
      return win;
    },
    shortcuts: globalShortcut,
    onShortcutFailed: (message) => dispatcher.emit({ type: 'status', message, level: 'warn' }),
  });

  app.on('second-instance', () => {
    const w = live();
    if (!w) return createMain();
    if (w.isMinimized()) w.restore();
    w.focus();
  });
  app.on('before-quit', (e) => lifecycle.onBeforeQuit(e));
  app.on('will-quit', (e) => {
    capture.unregister();
    lifecycle.onWillQuit(e);
  });
  app.on('window-all-closed', () => lifecycle.onAllWindowsClosed());
  app.on('activate', () => {
    if (!live()) createMain();
  });

  await app.whenReady();
  installSessionGuards(session.defaultSession, uiDist, e2e);
  const attachmentHandler = createAttachmentHandler(() => (wsr.ok ? wsr.value.attachments : undefined));
  session.defaultSession.protocol.handle(ATTACHMENT_SCHEME, (req) => attachmentHandler(req));
  registerRpc({ ipcMain, dispatcher, kinds, uiIndex, captureMethods: CAPTURE_METHODS });
  forwardEvents(dispatcher, () => BrowserWindow.getAllWindows());
  const parentOf = (id: number) => BrowserWindow.getAllWindows().find((w) => w.webContents.id === id);
  // Dialog and clipboard objects are looked up at call time, so an e2e run can stub them from the test.
  registerNative({
    ipcMain,
    kinds,
    uiIndex,
    ws: () => (wsr.ok ? wsr.value : undefined),
    tokens,
    pickPath: async (id) => {
      const opts = { properties: ['openFile' as const] };
      const w = parentOf(id);
      const r = await (w ? dialog.showOpenDialog(w, opts) : dialog.showOpenDialog(opts));
      return r.canceled ? undefined : r.filePaths[0];
    },
    pickSavePath: async (id, defaultName) => {
      const w = parentOf(id);
      const r = await (w
        ? dialog.showSaveDialog(w, { defaultPath: defaultName })
        : dialog.showSaveDialog({ defaultPath: defaultName }));
      return r.canceled ? undefined : r.filePath;
    },
    confirmRemote: async (id, host) => {
      const opts = {
        type: 'question' as const,
        buttons: ['Cancel', 'Load image'],
        defaultId: 0,
        cancelId: 0,
        message: `Load an image from ${host}?`,
        detail: `Mossnote will contact ${host}, which can see that you opened this note and your IP address.`,
        noLink: true,
      };
      const w = parentOf(id);
      const r = await (w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts));
      return r.response === 1;
    },
    clipboardPng: async (maxBytes) => {
      for (const item of await clipboard.read()) {
        if (!item.types.includes('image/png')) continue;
        const blob = await item.getType('image/png');
        return blob.size > maxBytes ? 'too_large' : new Uint8Array(await blob.arrayBuffer());
      }
      return undefined;
    },
    showInFolder: (p) => shell.showItemInFolder(p),
    writeCopy: copyOut,
    loadRemote: (url) => loadRemoteImage(url, nodeRemoteDeps),
    emit: (ev) => dispatcher.emit(ev),
  });
  const trusted = (e: { senderFrame?: { url: string } | null }) =>
    isOurPage(e.senderFrame?.url, uiIndex);
  if (e2e) {
    ipcMain.handle(CHANNELS.ping, (e, msg) => (trusted(e) ? `pong:${String(msg)}` : undefined));
    ipcMain.handle(CHANNELS.fts5Probe, (e) => (trusted(e) ? fts5Probe() : false));
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate(commands, {
        platform: process.platform,
        appName: app.name,
        send: (id) => {
          if (id === 'capture.open') return capture.open();
          const w = live();
          if (w) w.webContents.send(CHANNELS.event, { type: 'command', id });
          else createMain();
        },
      }),
    ),
  );
  capture.registerShortcut();
  createMain();
}
