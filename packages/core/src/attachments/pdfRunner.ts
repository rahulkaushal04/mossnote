// Entry point of the extraction child process (child_process.fork; no imports except Node built-ins and
// the pure extractor). Protocol: parent sends {path, limits}; child replies {ok:true,...} or
// {ok:false,error} once and exits. Written without enums or parameter properties so Node can run the
// file with type stripping.
import { readFileSync } from 'node:fs';
import { extractPdfText } from './pdfExtract.ts';

process.once('message', (m: unknown) => {
  const { path, limits } = m as { path: string; limits: { maxPages: number; maxTextBytes: number } };
  void (async () => {
    try {
      const r = await extractPdfText(readFileSync(path), limits);
      process.send?.({ ok: true, ...r }, () => process.exit(0));
    } catch (e) {
      const error = e instanceof Error ? e.message.slice(0, 300) : 'extraction failed';
      process.send?.({ ok: false, error }, () => process.exit(0));
    }
  })();
});
