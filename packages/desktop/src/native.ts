import {
  checkRemoteUrl,
  MAX_BYTES_INPUT,
  type AppError,
  type AppErrorCode,
  type AttachmentRef,
  type Result,
  type VerifiedBlob,
} from '@mossnote/core';
import type { RpcResult } from '@mossnote/core/rpc';
import type { Readable } from 'node:stream';
import { CHANNELS, isOurPage, type IpcEventLike, type IpcMainLike } from './ipc.ts';
import { createDialogGate, type DialogGate } from './portability.ts';
import type { RemoteResult } from './remoteImage.ts';
import type { UploadTokens } from './uploadTokens.ts';
import type { WindowKind } from './window.ts';

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_DROP = 100;
const MAX_PATH = 4096;
const MAX_ID = 64;
const TEXT_CAP_MAX = 256 * 1024;

/** Just what the handlers need from the workspace (a fake in tests). */
export interface NativeWorkspace {
  attachments: {
    openVerified(sha: string, o?: { noteId?: string }): Promise<Result<VerifiedBlob>>;
    addFromBytes(ctx: object, noteId: string, bytes: Uint8Array, name: string): Promise<Result<AttachmentRef>>;
    info(
      sha: string,
      o?: { noteId?: string; verify?: boolean },
    ): Promise<Result<{ refs: { noteId: string; name: string }[] }>>;
  };
}

export interface NativeDeps {
  ipcMain: IpcMainLike;
  kinds: ReadonlyMap<number, WindowKind>;
  uiIndex: string;
  /** The open workspace, or undefined when it failed to open. */
  ws(): NativeWorkspace | undefined;
  tokens: UploadTokens;
  /** Native open dialog (single file) attached to the sender's window; undefined when cancelled. */
  pickPath(senderId: number): Promise<string | undefined>;
  /** Native save dialog; undefined when cancelled. */
  pickSavePath(senderId: number, defaultName: string): Promise<string | undefined>;
  /** Native confirmation naming the exact host; true to go ahead. */
  confirmRemote(senderId: number, host: string): Promise<boolean>;
  /** PNG bytes of the clipboard image, 'too_large' above `maxBytes`, or undefined when there is none. */
  clipboardPng(maxBytes: number): Promise<Uint8Array | 'too_large' | undefined>;
  showInFolder(path: string): void;
  /** Writes `source` to `dest`, atomically where possible. */
  writeCopy(source: Readable, dest: string): Promise<void>;
  loadRemote(url: string): Promise<RemoteResult>;
  /** An attachment was added outside RPC: main announces `changed` and kicks the search pump like an RPC mutation. */
  onMutated(entity: 'attachment', ids: string[]): void;
  /** Shared with the portability pickers so two native dialogs never stack. Default: private to this module. */
  gate?: DialogGate;
}

const fail = (code: AppErrorCode, message: string) => ({ ok: false as const, error: { code, message } });
const DENIED = fail('unavailable', 'Not allowed.');
const NO_WORKSPACE = fail('unavailable', 'The workspace is not open.');
const strip = (e: AppError) => fail(e.code, String(e.message));
const validId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= MAX_ID;

export function registerNative(d: NativeDeps): void {
  // Same trust test as the RPC channel, and only the main window: the capture window has no `native`.
  const trusted = (e: IpcEventLike) =>
    isOurPage(e.senderFrame?.url, d.uiIndex) && d.kinds.get(e.sender.id) === 'main';
  const on = <A extends unknown[], R>(
    channel: string,
    denied: R,
    fn: (senderId: number, ...args: A) => Promise<R>,
  ) =>
    d.ipcMain.handle(channel, async (e, ...args) => {
      if (!trusted(e)) return denied;
      try {
        return await fn(e.sender.id, ...(args as A));
      } catch {
        return denied;
      }
    });

  // One native dialog at a time: a hostile page cannot stack them.
  const exclusive: DialogGate = d.gate ?? createDialogGate();

  on<[], string | undefined>(CHANNELS.pickFile, undefined, (id) =>
    exclusive<string | undefined>(undefined, async () => {
      const p = await d.pickPath(id);
      return p === undefined ? undefined : d.tokens.register(p);
    }),
  );

  on<[unknown], string[]>(CHANNELS.dropTokens, [], async (_id, paths) => {
    if (!Array.isArray(paths) || paths.length > MAX_DROP) return [];
    const out: string[] = [];
    for (const p of paths) {
      if (typeof p !== 'string' || p.length > MAX_PATH) continue;
      const t = await d.tokens.register(p);
      if (t) out.push(t);
    }
    return out;
  });

  on<[unknown], RpcResult<AttachmentRef | null>>(CHANNELS.pasteImage, DENIED, async (_id, noteId) => {
    if (!validId(noteId)) return fail('validation', 'Invalid note id.');
    const ws = d.ws();
    if (!ws) return NO_WORKSPACE;
    const png = await d.clipboardPng(MAX_BYTES_INPUT);
    if (!png || png.length === 0) return { ok: true, value: null };
    if (png === 'too_large' || png.length > MAX_BYTES_INPUT)
      return fail('validation', 'The pasted image is too large.');
    const r = await ws.attachments.addFromBytes({}, noteId, png, 'Pasted image.png');
    if (!r.ok) return strip(r.error);
    d.onMutated('attachment', [noteId]);
    return { ok: true, value: r.value };
  });

  /** Shared by reveal and save: the bytes are hash-verified (missing or corrupt files are refused) first. */
  const verified = async (sha: unknown, noteId: unknown) => {
    if (typeof sha !== 'string' || !HEX64.test(sha)) return fail('validation', 'Invalid attachment id.');
    if (noteId !== undefined && !validId(noteId)) return fail('validation', 'Invalid note id.');
    const ws = d.ws();
    if (!ws) return NO_WORKSPACE;
    const nid = noteId as string | undefined;
    const r = await ws.attachments.openVerified(sha, nid === undefined ? {} : { noteId: nid });
    return r.ok ? { ok: true as const, ws, blob: r.value, sha, noteId: nid } : strip(r.error);
  };

  on<[unknown, unknown], RpcResult<void>>(CHANNELS.reveal, DENIED, async (_id, sha, noteId) => {
    const v = await verified(sha, noteId);
    if (!v.ok) return v;
    try {
      d.showInFolder(v.blob.path); // the path stays in main
      return { ok: true, value: undefined };
    } finally {
      v.blob.close();
    }
  });

  on<[unknown, unknown], RpcResult<void>>(CHANNELS.saveCopy, DENIED, async (id, sha, noteId) => {
    const v = await verified(sha, noteId);
    if (!v.ok) return v;
    try {
      if (v.blob.kind === 'executable')
        return fail('validation', 'Programs and scripts cannot be saved from here. Use Reveal instead.');
      const nid = v.noteId;
      const info = await v.ws.attachments.info(v.sha, nid === undefined ? {} : { noteId: nid });
      const refs = info.ok ? info.value.refs : [];
      const name = (refs.find((x) => x.noteId === nid) ?? refs[0])?.name ?? v.sha.slice(0, 12);
      return await exclusive<RpcResult<void>>(fail('unavailable', 'A dialog is already open.'), async () => {
        const dest = await d.pickSavePath(id, name);
        if (dest === undefined) return { ok: true, value: undefined }; // cancelled
        try {
          await d.writeCopy(v.blob.stream(), dest);
        } catch {
          return fail('io', 'The copy could not be saved.');
        }
        return { ok: true, value: undefined };
      });
    } finally {
      v.blob.close();
    }
  });

  on<[unknown], RpcResult<{ dataUrl: string }>>(CHANNELS.loadRemoteImage, DENIED, async (id, url) => {
    if (typeof url !== 'string') return fail('validation', 'Invalid address.');
    const c = checkRemoteUrl(url); // also bounds the length
    if (!c.ok) return fail('validation', c.reason);
    return exclusive<RpcResult<{ dataUrl: string }>>(fail('unavailable', 'A dialog is already open.'), async () => {
      if (!(await d.confirmRemote(id, c.url.hostname))) return fail('unavailable', 'Cancelled.');
      const r = await d.loadRemote(c.url.toString());
      return r.ok ? { ok: true, value: { dataUrl: r.dataUrl } } : r;
    });
  });

  /** Text preview (AT-6): verified bytes, text kind only, at most `cap` (<= 256 KiB) bytes decoded as UTF-8 with replacement. */
  on<[unknown, unknown, unknown], RpcResult<{ text: string; truncated: boolean }>>(
    CHANNELS.readText,
    DENIED,
    async (_id, sha, noteId, cap) => {
      if (typeof cap !== 'number' || !Number.isFinite(cap)) return fail('validation', 'Invalid size.');
      const limit = Math.min(Math.max(Math.floor(cap), 1), TEXT_CAP_MAX);
      const v = await verified(sha, noteId);
      if (!v.ok) return v;
      try {
        if (v.blob.kind !== 'text') return fail('validation', 'This attachment is not a text file.');
        if (v.blob.size === 0) return { ok: true, value: { text: '', truncated: false } };
        const chunks: Buffer[] = [];
        let n = 0;
        // Read one byte more than the cap to know whether the file was cut.
        for await (const c of v.blob.stream({ start: 0, end: Math.min(v.blob.size, limit + 1) - 1 })) {
          const b = c as Buffer;
          chunks.push(b);
          n += b.length;
          if (n > limit) break;
        }
        const all = Buffer.concat(chunks);
        const truncated = all.length > limit;
        return { ok: true, value: { text: new TextDecoder('utf-8').decode(truncated ? all.subarray(0, limit) : all), truncated } };
      } catch {
        return fail('io', 'The attachment could not be read.');
      } finally {
        v.blob.close();
      }
    },
  );
}
