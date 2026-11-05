import type { RpcResult } from '@mossnote/core/rpc';
import type { AttachmentRef } from './types';

/**
 * What the preload adds as `window.mossnote.native` (main window only). Every file operation goes
 * through main: the page never supplies a path, only opaque single-use tokens main issued.
 * Absent in the capture window and in plain browsers; the UI then hides the native-only actions.
 */
export interface NativeBridge {
  /** Native file dialog in main; resolves to an upload token, or undefined when cancelled. */
  pickFile(): Promise<string | undefined>;
  /** Turns dropped File objects into single-use tokens (empty paths are dropped by the preload). */
  dropTokens(files: File[]): Promise<string[]>;
  /** Main reads the clipboard and adds the image to the note; value is null when it holds no image. */
  pasteImage(noteId: string): Promise<RpcResult<AttachmentRef | null>>;
  reveal(sha256: string, noteId?: string): Promise<unknown>;
  saveCopy(sha256: string, noteId?: string): Promise<unknown>;
  /** OPTIONAL (not in the frozen preload yet): up to `cap` bytes of a text attachment, for the text preview. */
  readText?(
    sha256: string,
    noteId: string | undefined,
    cap: number,
  ): Promise<RpcResult<{ text: string }>>;
  /** Native confirmation (shows the host) in main, then a guarded https fetch. Result is a data: URL. */
  loadRemoteImage(url: string): Promise<RpcResult<{ dataUrl: string }>>;
}

/** Read at call time so tests can install a fake on `window.mossnote` (or pass `native` as a prop). */
export function getNative(): NativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window.mossnote as { native?: NativeBridge } | undefined)?.native;
}
