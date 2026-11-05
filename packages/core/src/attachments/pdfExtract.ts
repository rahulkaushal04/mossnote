import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Pure PDF text extraction (AT-7). Runs INSIDE the isolated process (pdfRunner.ts; in production an
 * Electron utilityProcess wired by the desktop stage), never on the main thread: a hostile PDF can
 * spin or exhaust memory, and a single getTextContent() call cannot be interrupted from within.
 * pdf.js 6 has no eval code path and no scripting in the Node build; fonts are not loaded as web fonts.
 * v1 renders nothing.
 */

export interface PdfLimits {
  maxPages: number;
  /** UTF-8 bytes of extracted text kept. */
  maxTextBytes: number;
  /** Parent-side kill timer. */
  timeoutMs: number;
  /** Child heap limit (MB). */
  maxOldSpaceMb: number;
}
export const PDF_LIMITS: PdfLimits = {
  maxPages: 500,
  maxTextBytes: 2 * 1024 * 1024,
  timeoutMs: 15_000,
  maxOldSpaceMb: 512,
};

export interface PdfText {
  text: string;
  pages: number;
  /** A cap (pages or text) cut the extraction short. */
  truncated: boolean;
}

function assetDirs(): Record<string, string> {
  try {
    const dir = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
    return {
      cMapUrl: join(dir, 'cmaps') + '/',
      standardFontDataUrl: join(dir, 'standard_fonts') + '/',
      wasmUrl: join(dir, 'wasm') + '/',
    };
  } catch {
    return {};
  }
}

/** Throws on a PDF pdf.js cannot open (caller records text_state 'failed'). */
export async function extractPdfText(
  data: Uint8Array,
  limits: Pick<PdfLimits, 'maxPages' | 'maxTextBytes'> = PDF_LIMITS,
): Promise<PdfText> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data), // pdf.js takes ownership of the buffer
    enableXfa: false,
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    verbosity: 0,
    ...assetDirs(),
  });
  const doc = await task.promise;
  try {
    const total = doc.numPages;
    const last = Math.min(total, limits.maxPages);
    let text = '';
    let bytes = 0;
    let truncated = total > last;
    for (let p = 1; p <= last && !truncated; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      page.cleanup();
      let chunk = '';
      for (const item of content.items) {
        if ('str' in item) chunk += item.str + (item.hasEOL ? '\n' : ' ');
      }
      const b = Buffer.byteLength(chunk, 'utf8');
      if (bytes + b > limits.maxTextBytes) {
        let cut = chunk.slice(0, Math.max(0, limits.maxTextBytes - bytes));
        while (Buffer.byteLength(cut, 'utf8') > limits.maxTextBytes - bytes) cut = cut.slice(0, -1);
        text += cut;
        truncated = true;
        break;
      }
      text += chunk + '\n';
      bytes += b + 1;
    }
    return { text, pages: total, truncated };
  } finally {
    await task.destroy();
  }
}
