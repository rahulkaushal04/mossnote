// Crash-test child: types a seeded string through the draft journal until it is SIGKILLed.
// stdout: "ready", then "k <codepoints typed>" before every keystroke.
import { writeSync } from 'node:fs';
import { createDraftsApi } from '../../packages/core/src/drafts/index.ts';
import { integrityGuard } from '../../packages/core/src/integrity/index.ts';
import { lockGuard } from '../../packages/core/src/lock/index.ts';
import { createNotesApi } from '../../packages/core/src/notes/notes.ts';
import { openStore } from '../../packages/core/src/store/store.ts';
import { mulberry32, seededText } from './seed.ts';

const [dir, seedArg] = process.argv.slice(2) as [string, string];
const seed = Number(seedArg);
const r = openStore(`${dir}/n.db`, { guards: [lockGuard, integrityGuard] });
if (!r.ok) throw new Error(r.error.message);
const store = r.value;
const rng = mulberry32(seed ^ 0x9e3779b9);
const text = [...seededText(seed)];
const drafts = createDraftsApi(store);

const notes = createNotesApi(store);
const existing = store.db.prepare('SELECT id FROM notes LIMIT 1').get() as
  { id: string } | undefined;
const created = existing ? undefined : notes.create({}, { title: 't', body: '' });
if (created && !created.ok) throw new Error(created.error.message);
const noteId = existing?.id ?? created!.value.id;
const first = notes.get(noteId);
if (!first.ok) throw new Error(first.error.message);
let rev = first.value.rev;
let hash = first.value.contentHash;
writeSync(1, 'ready\n');

// A real save through notes.update: draft cleanup (ctx.draftSeq, by seq, never by text) commits in
// the same transaction as the body, version and change-log row, so a kill -9 cannot split them.
function save(body: string) {
  const f = drafts.flush(noteId);
  if (!f.ok) throw new Error(f.error.message);
  const res = notes.update({ draftSeq: f.value[noteId] }, noteId, { body });
  if (!res.ok) throw new Error(res.error.message);
  rev = res.value.rev;
  hash = res.value.contentHash;
}

let i = 0;
let nextSave = 20 + Math.floor(rng() * 100);
const tick = () => {
  if (i >= text.length) return void setTimeout(() => undefined, 60_000);
  writeSync(1, `k ${i + 1}\n`);
  i += 1;
  drafts.write(noteId, text.slice(0, i).join(''), { rev, contentHash: hash });
  if (i === nextSave) {
    save(text.slice(0, i).join(''));
    nextSave += 20 + Math.floor(rng() * 150); // saves land at random points, so kills hit transactions too
  }
  setTimeout(tick, 5 + Math.floor(rng() * 40));
};
tick();
