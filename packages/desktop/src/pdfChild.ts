// Entry of the PDF extraction utilityProcess (bundled to dist/pdfChild.cjs by build.mjs). No Electron
// import: the parent port is a property of `process` inside a utility process. One request, one reply.
import { readFileSync } from 'node:fs';
import { extractPdfText } from '@mossnote/core/attachments/pdf';

interface ParentPort {
  once(ev: 'message', cb: (e: { data: unknown }) => void): void;
  postMessage(m: unknown): void;
}
const port = (process as unknown as { parentPort?: ParentPort }).parentPort;

port?.once('message', (e) => {
  const { path, limits } = e.data as { path: string; limits: { maxPages: number; maxTextBytes: number } };
  void (async () => {
    try {
      port.postMessage({ ok: true, ...(await extractPdfText(readFileSync(path), limits)) });
    } catch (err) {
      port.postMessage({
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 300) : 'extraction failed',
      });
    }
  })();
});
