import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../src/attachments/pdfExtract.ts';
import { createForkExtractor } from '../../src/attachments/pdfText.ts';
import { tmp } from '../store/helpers.ts';
import { fakePdf, makePdf, mkNote, openAtt, put, sleep, textPdf, unwrap } from './util.ts';
import { find, ids } from '../search/util.ts';

const pdfBytes = makePdf('quokkamarker zanzibar');

describe('AT-7 PDF text reaches search', () => {
  it('after extraction the note is found by a word that exists only in the PDF, with an attachment snippet', async () => {
    const a = openAtt({ pdf: textPdf('The zebrafish annual report mentions quokkas') });
    const n = mkNote(a.w, 'Plan', 'nothing relevant');
    const r = unwrap(await a.w.attachments.addFromPath({}, n, put(a, 'report.pdf', pdfBytes)));
    expect(r).toMatchObject({ kind: 'pdf', textState: 'pending' });
    expect(ids(find(a.w, 'zebrafish'))).toEqual([]); // not yet
    expect(await a.w.attachments.extractPending()).toEqual({ processed: 1, noteIds: [n] });
    expect(unwrap(a.w.attachments.listForNote(n))[0]!.textState).toBe('done');
    const page = find(a.w, 'zebrafish');
    expect(ids(page)).toEqual([n]);
    const hit = page.hits[0]!;
    expect(hit.snippet.text).toContain('zebrafish');
    expect(hit.snippet.text.slice(...hit.snippet.ranges[0]!)).toBe('zebrafish');
    // prefix and phrase queries work over the attachment column too
    expect(ids(find(a.w, 'quokk*'))).toEqual([n]);
    expect(ids(find(a.w, '"annual report"'))).toEqual([n]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });

  it('a body hit still shows the body snippet; a PDF-only hit is found too', async () => {
    const a = openAtt({ pdf: textPdf('kiwi kiwi kiwi') });
    const withBody = mkNote(a.w, 'A', 'kiwi in the body');
    const withPdf = mkNote(a.w, 'B', 'something else');
    unwrap(await a.w.attachments.addFromBytes({}, withPdf, pdfBytes, 'k.pdf'));
    await a.w.attachments.extractPending();
    const page = find(a.w, 'kiwi');
    expect(page.hits.find((h) => h.noteId === withBody)!.snippet.text).toContain('body');
    expect(new Set(ids(page))).toEqual(new Set([withBody, withPdf]));
  });

  it('a rebuild keeps the attachment hit', async () => {
    const a = openAtt({ pdf: textPdf('elderberry wine') });
    const n = mkNote(a.w, 'Plan');
    unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'r.pdf'));
    await a.w.attachments.extractPending();
    unwrap(a.w.search.rebuild());
    expect(ids(find(a.w, 'elderberry'))).toEqual([n]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });

  it('a failing, throwing or timed-out extractor never blocks the add (state failed)', async () => {
    const cases = {
      rejects: fakePdf(() => Promise.reject(new Error('bad pdf'))),
      timeout: fakePdf(() => Promise.reject(new Error('PDF text extraction timed out'))),
      throws: fakePdf(() => {
        throw new Error('sync boom');
      }),
    };
    for (const [name, pdf] of Object.entries(cases)) {
      const a = openAtt({ pdf });
      const n = mkNote(a.w);
      const r = await a.w.attachments.addFromBytes({}, n, pdfBytes, 'b.pdf');
      expect(r.ok, name).toBe(true);
      expect((await a.w.attachments.extractPending()).processed, name).toBe(1);
      const ref = unwrap(a.w.attachments.listForNote(n))[0]!;
      expect(ref.textState, name).toBe('failed');
      expect(ids(find(a.w, 'quokkamarker')), name).toEqual([]);
    }
  });

  it('a damaged PDF file is not handed to the extractor', async () => {
    const pdf = textPdf('never used');
    const a = openAtt({ pdf });
    const n = mkNote(a.w);
    const r = unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'c.pdf'));
    writeFileSync(join(a.root, r.sha256.slice(0, 2), r.sha256.slice(2, 4), r.sha256), 'garbage');
    await a.w.attachments.extractPending();
    expect(pdf.calls).toEqual([]);
    expect(unwrap(a.w.attachments.listForNote(n))[0]!.textState).toBe('failed');
  });

  it('extractPending runs one pass at a time and a second caller gets the same result', async () => {
    const a = openAtt({ pdf: textPdf('hello') });
    unwrap(await a.w.attachments.addFromBytes({}, mkNote(a.w), pdfBytes, 'one.pdf'));
    const [x, y] = await Promise.all([a.w.attachments.extractPending(), a.w.attachments.extractPending()]);
    expect(x).toBe(y);
    expect(x.processed).toBe(1);
    expect(await a.w.attachments.extractPending()).toEqual({ processed: 0, noteIds: [] });
  });

  it('the same PDF in two notes indexes both; removing one reference keeps the other', async () => {
    const a = openAtt({ pdf: textPdf('persimmon tart') });
    const n1 = mkNote(a.w, 'N1');
    const n2 = mkNote(a.w, 'N2');
    const r1 = unwrap(await a.w.attachments.addFromBytes({}, n1, pdfBytes, 'a.pdf'));
    unwrap(await a.w.attachments.addFromBytes({}, n2, pdfBytes, 'b.pdf'));
    await a.w.attachments.extractPending();
    expect(new Set(ids(find(a.w, 'persimmon')))).toEqual(new Set([n1, n2]));
    unwrap(a.w.attachments.removeRef({}, r1.refId));
    expect(ids(find(a.w, 'persimmon'))).toEqual([n2]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
  });
});

describe('M10 purge clears extracted text', () => {
  const textOf = (a: ReturnType<typeof openAtt>): string[] =>
    (a.w.store.db.prepare('SELECT text FROM attachments').all() as { text: string }[]).map((r) => r.text);

  it('purging the last reference empties the text, the search hit and the bytes in the database file', async () => {
    const a = openAtt({ pdf: textPdf('gooseberry fool') });
    const n = mkNote(a.w, 'Plan');
    const r = unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'g.pdf'));
    await a.w.attachments.extractPending();
    expect(ids(find(a.w, 'gooseberry'))).toEqual([n]);
    unwrap(a.w.trash.trashNote({}, n));
    const batch = unwrap(a.w.trash.list())[0]!.batchId;
    unwrap(a.w.trash.purgeBatch({}, batch, { confirmed: true }));
    expect(textOf(a)).toEqual(['']);
    expect(
      a.w.store.db.prepare('SELECT text_state AS s FROM attachments WHERE sha256 = ?').get(r.sha256),
    ).toEqual({ s: 'none' });
    expect(ids(find(a.w, 'gooseberry'))).toEqual([]);
    expect(unwrap(a.w.search.verify()).ok).toBe(true);
    // the reference row, its log fields and a tombstone for it are handled like the note's own
    expect(a.w.store.db.prepare('SELECT count(*) AS n FROM note_attachments').get()).toEqual({ n: 0 });
    const logged = a.w.store.db
      .prepare("SELECT fields FROM change_log WHERE entity = 'attachment_ref' AND op = 'create'")
      .get() as { fields: string | null };
    expect(logged.fields).toBeNull();
    const purgeRow = a.w.store.db
      .prepare("SELECT purged_ids FROM change_log WHERE entity = 'note' AND op = 'purge'")
      .get() as { purged_ids: string };
    expect(JSON.parse(purgeRow.purged_ids)).toContainEqual({ entity: 'attachment_ref', id: r.refId });
    expect(a.w.store.db.prepare('SELECT 1 FROM tombstones WHERE entity_id = ?').get(r.refId)).toBeDefined();
  });

  it('the text does not survive in the database or WAL bytes', async () => {
    const a = openAtt({ pdf: textPdf('xylophonequince uniqueword') });
    const n = mkNote(a.w, 'Plan');
    unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'x.pdf'));
    await a.w.attachments.extractPending();
    const scan = (): boolean =>
      [a.path, `${a.path}-wal`].some(
        (p) => existsSync(p) && readFileSync(p).includes(Buffer.from('xylophonequince')),
      );
    a.w.store.db.pragma('wal_checkpoint(TRUNCATE)');
    expect(scan()).toBe(true); // sanity: the bytes were there before the purge
    unwrap(a.w.trash.trashNote({}, n));
    unwrap(a.w.trash.purgeBatch({}, unwrap(a.w.trash.list())[0]!.batchId, { confirmed: true }));
    expect(scan()).toBe(false);
  });

  it('removing the last reference from a live note clears the text too; another reference keeps it', async () => {
    const a = openAtt({ pdf: textPdf('lychee sorbet') });
    const n1 = mkNote(a.w, 'N1');
    const n2 = mkNote(a.w, 'N2');
    const r1 = unwrap(await a.w.attachments.addFromBytes({}, n1, pdfBytes, 'a.pdf'));
    const r2 = unwrap(await a.w.attachments.addFromBytes({}, n2, pdfBytes, 'b.pdf'));
    await a.w.attachments.extractPending();
    unwrap(a.w.attachments.removeRef({}, r1.refId));
    expect(textOf(a)).toEqual(['lychee sorbet']); // r2 still uses it
    unwrap(a.w.attachments.removeRef({}, r2.refId));
    expect(textOf(a)).toEqual(['']);
  });

  it('a purge while extraction is running stores nothing', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const a = openAtt({
      pdf: fakePdf(async () => {
        await gate;
        return { text: 'late text', pages: 1, truncated: false };
      }),
    });
    const n = mkNote(a.w);
    unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'p.pdf'));
    const running = a.w.attachments.extractPending();
    await sleep(30);
    unwrap(a.w.trash.trashNote({}, n));
    unwrap(a.w.trash.purgeBatch({}, unwrap(a.w.trash.list())[0]!.batchId, { confirmed: true }));
    release();
    expect((await running).noteIds).toEqual([]);
    expect(textOf(a)).toEqual(['']);
    expect(a.w.store.db.prepare('SELECT text_state AS s FROM attachments').get()).toEqual({ s: 'none' });
  });

  it('re-adding the PDF after its text was cleared extracts it again', async () => {
    const pdf = textPdf('rhubarb crumble');
    const a = openAtt({ pdf });
    const n = mkNote(a.w);
    const r = unwrap(await a.w.attachments.addFromBytes({}, n, pdfBytes, 'p.pdf'));
    await a.w.attachments.extractPending();
    unwrap(a.w.attachments.removeRef({}, r.refId));
    const n2 = mkNote(a.w, 'Again');
    unwrap(await a.w.attachments.addFromBytes({}, n2, pdfBytes, 'p.pdf'));
    await a.w.attachments.extractPending();
    expect(ids(find(a.w, 'rhubarb'))).toEqual([n2]);
    expect(pdf.calls).toHaveLength(2);
  });
});

describe('pdf.js extraction (pure function, isolated process)', () => {
  it('extracts the text layer in-process and honours the page and text caps', async () => {
    const r = await extractPdfText(pdfBytes);
    expect(r.text).toContain('quokkamarker');
    expect(r.pages).toBe(1);
    expect(r.truncated).toBe(false);
    const cut = await extractPdfText(pdfBytes, { maxPages: 1, maxTextBytes: 8 });
    expect(Buffer.byteLength(cut.text)).toBeLessThanOrEqual(8);
    expect(cut.truncated).toBe(true);
    await expect(extractPdfText(Buffer.from('this is not a pdf'))).rejects.toThrow();
  }, 60_000);

  it('the forked extractor returns the same text and the file is never evaluated', async () => {
    const x = createForkExtractor();
    const dir = tmp();
    const p = join(dir, 'f.pdf');
    writeFileSync(p, pdfBytes);
    const r = await x.extract(p);
    expect(r.text).toContain('zanzibar');
    x.dispose();
  }, 60_000);

  it('kills a hanging child at the timeout and reports a crash', async () => {
    const dir = tmp();
    const hang = join(dir, 'hang.mjs');
    writeFileSync(hang, 'process.on("message", () => { setInterval(() => {}, 1000); });\n');
    const crash = join(dir, 'crash.mjs');
    writeFileSync(crash, 'process.on("message", () => { process.exit(3); });\n');
    const t0 = Date.now();
    await expect(createForkExtractor({ runner: hang, timeoutMs: 400 }).extract('x')).rejects.toThrow(/timed out/);
    expect(Date.now() - t0).toBeLessThan(10_000);
    await expect(createForkExtractor({ runner: crash, timeoutMs: 5000 }).extract('x')).rejects.toThrow(/exited/);
  }, 60_000);
});
