import type { AttachmentRef } from '@mossnote/core';
import type { RpcEvent, RpcResult } from '@mossnote/core/rpc';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { WindowKind } from './window.ts';

// Type-only core imports: the preload bundle must not pull in zod or core.
export const CHANNELS = {
  ping: 'mossnote:ping',
  fts5Probe: 'mossnote:fts5Probe',
  rpc: 'mossnote:rpc',
  event: 'mossnote:event',
  // Native attachment helpers (main window only). Separate from `mossnote:rpc`: they open dialogs and read the clipboard.
  pickFile: 'mossnote:native:pickFile',
  dropTokens: 'mossnote:native:dropTokens',
  pasteImage: 'mossnote:native:pasteImage',
  reveal: 'mossnote:native:reveal',
  saveCopy: 'mossnote:native:saveCopy',
  loadRemoteImage: 'mossnote:native:loadRemoteImage',
  readText: 'mossnote:native:readText',
} as const;

/** Passed to the preload only for the capture window, which never gets `native`. */
export const CAPTURE_ARG = '--mossnote-capture';

/** `window.mossnote.native`: attachment helpers. Paths never cross to the page; tokens do. */
export interface NativeApi {
  /** An upload token for a file chosen in a native open dialog; undefined when cancelled. */
  pickFile(): Promise<string | undefined>;
  /** Upload tokens for dropped files (the preload reads their paths); refused files are left out. */
  dropTokens(files: File[]): Promise<string[]>;
  /** null when the clipboard has no image. */
  pasteImage(
    noteId: string,
  ): Promise<{ ok: true; value: AttachmentRef | null } | { ok: false; error: { code: string; message: string } }>;
  reveal(sha256: string, noteId?: string): Promise<RpcResult<void>>;
  saveCopy(sha256: string, noteId?: string): Promise<RpcResult<void>>;
  loadRemoteImage(url: string): Promise<RpcResult<{ dataUrl: string }>>;
  /** Text attachment preview: the first `cap` bytes (clamped to 256 KiB) decoded as UTF-8. */
  readText(
    sha256: string,
    noteId: string | undefined,
    cap: number,
  ): Promise<RpcResult<{ text: string; truncated: boolean }>>;
}

/** Passed to the preload (webPreferences.additionalArguments) only when main runs with MOSSNOTE_E2E=1. */
export const E2E_ARG = '--mossnote-e2e';

/** Typed surface exposed to the renderer as `window.mossnote` (ping/fts5Probe exist only under MOSSNOTE_E2E=1). */
export interface MossnoteApi {
  ping?(msg: string): Promise<string>;
  fts5Probe?(): Promise<boolean>;
  rpc(method: string, args?: unknown): Promise<RpcResult<unknown>>;
  onEvent(cb: (e: RpcEvent) => void): () => void;
  /** Main window only. */
  native?: NativeApi;
}

export interface IpcEventLike {
  sender: { id: number };
  senderFrame?: { url: string } | null;
}
export interface IpcMainLike {
  handle(channel: string, fn: (e: IpcEventLike, ...args: unknown[]) => unknown): void;
}

const denied: RpcResult<never> = {
  ok: false,
  error: { code: 'unavailable', message: 'Not allowed.' },
};

/** Compares the file path only, so `index.html#capture` and `?x` match. */
export function isOurPage(url: string | undefined, uiIndex: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'file:' &&
      u.host === '' &&
      path.resolve(fileURLToPath(u)) === path.resolve(uiIndex)
    );
  } catch {
    return false;
  }
}

export interface RpcGlueOptions {
  ipcMain: IpcMainLike;
  dispatcher: { handle(method: unknown, args: unknown): Promise<RpcResult<unknown>> };
  /** webContents id -> kind; a sender that is not registered is refused. */
  kinds: ReadonlyMap<number, WindowKind>;
  uiIndex: string;
  /** CAPTURE_METHODS from core; injected so the preload bundle never imports core values. */
  captureMethods: readonly string[];
}

export function registerRpc(o: RpcGlueOptions): void {
  const kindOf = (e: IpcEventLike) =>
    isOurPage(e.senderFrame?.url, o.uiIndex) ? o.kinds.get(e.sender.id) : undefined;

  o.ipcMain.handle(CHANNELS.rpc, async (e, method, args) => {
    const kind = kindOf(e);
    if (!kind) return denied;
    if (kind === 'capture' && !(typeof method === 'string' && o.captureMethods.includes(method)))
      return denied;
    return o.dispatcher.handle(method, args); // validates method (own property) and args
  });
}

export interface EventTarget {
  isDestroyed(): boolean;
  webContents: { send(channel: string, payload: unknown): void };
}
/** Broadcasts dispatcher events to every live app window. */
export function forwardEvents(
  dispatcher: { onEvent(cb: (e: RpcEvent) => void): () => void },
  windows: () => Iterable<EventTarget>,
): () => void {
  return dispatcher.onEvent((e) => {
    for (const w of windows()) if (!w.isDestroyed()) w.webContents.send(CHANNELS.event, e);
  });
}
