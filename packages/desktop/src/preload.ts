import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { CAPTURE_ARG, CHANNELS, E2E_ARG, type MossnoteApi, type NativeApi } from './ipc.ts';

const MAX_DROP = 100;
/** Only the preload sees a dropped File's path; the page gets tokens back. */
function dropPaths(files: unknown): string[] {
  if (!Array.isArray(files)) return [];
  const out: string[] = [];
  for (const f of files.slice(0, MAX_DROP)) {
    try {
      const p = webUtils.getPathForFile(f as File);
      if (p) out.push(p);
    } catch {
      /* not a File */
    }
  }
  return out;
}

const native: NativeApi = {
  pickFile: () => ipcRenderer.invoke(CHANNELS.pickFile),
  dropTokens: async (files) => {
    const paths = dropPaths(files);
    return paths.length ? ipcRenderer.invoke(CHANNELS.dropTokens, paths) : [];
  },
  pasteImage: (noteId) => ipcRenderer.invoke(CHANNELS.pasteImage, noteId),
  reveal: (sha256, noteId) => ipcRenderer.invoke(CHANNELS.reveal, sha256, noteId),
  saveCopy: (sha256, noteId) => ipcRenderer.invoke(CHANNELS.saveCopy, sha256, noteId),
  loadRemoteImage: (url) => ipcRenderer.invoke(CHANNELS.loadRemoteImage, url),
  readText: (sha256, noteId, cap) => ipcRenderer.invoke(CHANNELS.readText, sha256, noteId, cap),
};

const api: MossnoteApi = {
  // The smoke-test probes exist only for e2e runs; a normal page cannot even see them.
  ...(process.argv.includes(E2E_ARG)
    ? {
        ping: (msg: string) => ipcRenderer.invoke(CHANNELS.ping, msg),
        fts5Probe: () => ipcRenderer.invoke(CHANNELS.fts5Probe),
      }
    : {}),
  ...(process.argv.includes(CAPTURE_ARG) ? {} : { native }),
  rpc: (method, args) => ipcRenderer.invoke(CHANNELS.rpc, method, args),
  onEvent(cb) {
    // Page code gets the payload only, never the IpcRendererEvent.
    const h = (_e: unknown, payload: Parameters<typeof cb>[0]) => cb(payload);
    ipcRenderer.on(CHANNELS.event, h);
    return () => void ipcRenderer.removeListener(CHANNELS.event, h);
  },
};
contextBridge.exposeInMainWorld('mossnote', api);
