import { makeRng, subRng, zipf, type Rng } from './rng.ts';

// Real words first, in rough English frequency order, so the head of the Zipf curve is
// "the/of/and" (a worst case for search: they match nearly every note).
const REAL =
  `the of and to a in is that it for was on with as be at by this have from or one had not but what all were when we there can an your which their said if do will each about how up out them then she many some so these would other into has more her two like him see time could no make than first been its who now people my made over did down only way find use may water long little very after words called just where most know get through back much before go good new write our used me man too any day same right look think also around another came come work three word must because does part even place well such here take why help put different away again off went old number great tell men say small every found still between name should home big give air line set own under read last never us left end along while might next sound below saw something thought both few those always looked show large often together asked house don't world going want school important until form food keep children feet land side without boy once animals life enough took sometimes four head above kind began almost live page got earth need far hand high year mother light country father let night picture being study second soon story since white ever paper hard near sentence better best across during today however sure knew try told young sun thing whole hear example heard several change answer room sea against top turned learn point city play toward five using himself usually money seen didn't car morning added friend easy north eye fire pattern notes meeting project ideas draft review plan budget research design release roadmap customer feedback bug feature report summary agenda tasks goals reading recipe travel budget health journal garden music book movie quote lesson interview proposal`.split(
    /\s+/,
  );

const SYL =
  'ba be bi bo bu ca ce co cu da de di do du fa fe fo ga ge gi go la le li lo lu ma me mi mo mu na ne ni no nu pa pe pi po pu ra re ri ro ru sa se si so su ta te ti to tu va ve vi vo wa we xa za ka ke ki ko ku'.split(
    ' ',
  );

export const VOCAB_SIZE = 20_000;

/** Fixed vocabulary, independent of the dataset seed so the query set stays stable. */
export const VOCAB: readonly string[] = (() => {
  const seen = new Set<string>(REAL);
  const out = [...seen];
  const r = makeRng(12345);
  while (out.length < VOCAB_SIZE) {
    const n = 2 + r.int(3);
    let w = '';
    for (let i = 0; i < n; i++) w += r.pick(SYL);
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
})();

const wordZipf = zipf(VOCAB_SIZE);

const PHRASES = [
  'meeting notes',
  'action items',
  'next steps',
  'follow up',
  'open questions',
  'quick summary',
  'release plan',
  'user feedback',
  'weekly review',
  'project kickoff',
  'design decision',
  'technical debt',
  'reading list',
  'shopping list',
  'travel plan',
  'budget review',
  'bug report',
  'feature request',
  'long term goals',
  'daily journal',
];
export const PHRASE_LIST: readonly string[] = PHRASES;

const TAG_WORDS =
  `work personal ideas project todo reading meeting journal health travel finance recipes music books movies quotes learning research design code writing family home garden fitness goals review archive reference inbox draft urgent later waiting people places tools notes planning budget career study blog podcast shopping gifts events`.split(
    /\s+/,
  );
export const TAG_POOL: readonly string[] = (() => {
  const out = [...new Set(TAG_WORDS)];
  for (let i = 0; out.length < 300; i++) out.push(`topic-${i}`);
  return out;
})();
const tagZipf = zipf(TAG_POOL.length);

export interface NoteSpec {
  index: number;
  body: string;
  tags: string[];
  /** Index into the folder plan, -1 for the root. */
  folder: number;
  favorite: boolean;
  trashed: boolean;
  createdAt: number;
}

export interface GenContext {
  seed: number;
  total: number;
  folders: number;
}

export const BASE_TIME = Date.UTC(2024, 0, 1);
const SPAN_MS = 2 * 365 * 24 * 3600 * 1000;

const word = (r: Rng): string => VOCAB[wordZipf(r)] as string;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const words = (r: Rng, n: number): string => Array.from({ length: n }, () => word(r)).join(' ');

function sentence(r: Rng): string {
  let s = words(r, 7 + r.int(12));
  const x = r.next();
  if (x < 0.1) s += ` ${r.pick(PHRASES)}`;
  else if (x < 0.18) s += ` [${word(r)}](https://example.com/${word(r)}/${r.int(1000)})`;
  else if (x < 0.23) s += ` [[${cap(words(r, 2))}]]`;
  return `${cap(s)}${r.next() < 0.9 ? '.' : r.next() < 0.5 ? '?' : '!'}`;
}

function block(r: Rng): string {
  const x = r.next();
  const lines = (n: number, f: (i: number) => string) =>
    Array.from({ length: n }, (_, i) => f(i)).join('\n');
  if (x < 0.1) return `${'#'.repeat(2 + r.int(2))} ${cap(words(r, 2 + r.int(4)))}`;
  if (x < 0.25) return lines(3 + r.int(5), () => `- ${cap(words(r, 3 + r.int(8)))}`);
  if (x < 0.35)
    return lines(
      2 + r.int(5),
      () => `- [${r.next() < 0.4 ? 'x' : ' '}] ${cap(words(r, 3 + r.int(7)))}`,
    );
  return Array.from({ length: 2 + r.int(4) }, () => sentence(r)).join(' ');
}

/** Lognormal bytes: median 1.5 KB, sigma chosen so p99 is about 50 KB. */
export function targetSize(r: Rng): number {
  const u1 = Math.max(r.next(), 1e-12);
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * r.next());
  const sigma = Math.log(50_000 / 1500) / 2.326;
  return Math.max(40, Math.min(300_000, Math.round(1500 * Math.exp(sigma * z))));
}

export function makeBody(r: Rng, target: number): string {
  let out = `# ${cap(words(r, 2 + r.int(4)))}`;
  while (out.length < target) {
    let b = block(r);
    const room = target - out.length - 2;
    if (b.length > room) {
      const cut = b.lastIndexOf(' ', room);
      if (room < 20 || cut < 10) break;
      b = b.slice(0, cut);
    }
    out += `\n\n${b}`;
  }
  return out;
}

/** Folder plan: parent index per folder (-1 = root), at most 5 levels deep. Deterministic. */
export function folderPlan(seed: number, count: number): { name: string; parent: number }[] {
  const r = subRng(seed, 1_000_000_001);
  const depth: number[] = [];
  const plan: { name: string; parent: number }[] = [];
  for (let j = 0; j < count; j++) {
    let parent = -1;
    if (j > 3 && r.next() > 0.2) {
      parent = r.int(j);
      if ((depth[parent] as number) >= 4) parent = -1;
    }
    depth.push(parent < 0 ? 0 : (depth[parent] as number) + 1);
    plan.push({ name: `${cap(word(r))} ${j}`, parent });
  }
  return plan;
}

export const folderCountFor = (total: number): number =>
  Math.min(1000, Math.max(3, Math.round(total / 100)));

export function genNote(ctx: GenContext, index: number): NoteSpec {
  const r = subRng(ctx.seed, index);
  const body = makeBody(r, targetSize(r));
  const nt = r.next();
  const count = nt < 0.25 ? 0 : nt < 0.55 ? 1 : nt < 0.8 ? 2 : nt < 0.95 ? 3 : 4;
  const tags = new Set<string>();
  while (tags.size < count) tags.add(TAG_POOL[tagZipf(r)] as string);
  const folder = r.next() < 0.12 ? -1 : Math.floor(ctx.folders * r.next() ** 2);
  return {
    index,
    body,
    tags: [...tags].sort(),
    folder,
    favorite: r.next() < 0.03,
    trashed: r.next() < 0.02,
    createdAt: BASE_TIME + Math.floor((index * SPAN_MS) / ctx.total),
  };
}
