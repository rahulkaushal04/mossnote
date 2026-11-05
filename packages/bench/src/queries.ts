import { makeRng } from './rng.ts';
import { BASE_TIME, PHRASE_LIST, TAG_POOL, VOCAB } from './text.ts';

export const CATEGORIES = [
  'term',
  'terms',
  'rare',
  'common',
  'prefix',
  'phrase',
  'tag',
  'folder',
  'date',
  'exclude',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface QuerySpec {
  category: Category;
  query: string;
  tag?: string;
  /** Index into the dataset's folder plan; the harness resolves it to an id. */
  folder?: number;
  createdFrom?: number;
  createdTo?: number;
}

export const QUERY_COUNT = 200;
const DAY = 24 * 3600 * 1000;

/** The fixed 200-query set. It depends only on the fixed vocabulary, never on the dataset seed or size. */
export function buildQuerySet(): QuerySpec[] {
  const r = makeRng(777);
  const w = (lo: number, hi: number): string => VOCAB[lo + r.int(hi - lo)] as string;
  const out: QuerySpec[] = [];
  const add = (n: number, f: (i: number) => Omit<QuerySpec, 'category'>, category: Category) => {
    for (let i = 0; i < n; i++) out.push({ category, ...f(i) });
  };
  add(30, (i) => ({ query: i < 10 ? w(20, 200) : i < 20 ? w(200, 2000) : w(2000, 8000) }), 'term');
  add(
    30,
    (i) => ({
      query: i % 2 ? `${w(20, 500)} ${w(20, 500)}` : `${w(50, 2000)} ${w(20, 800)} ${w(20, 800)}`,
    }),
    'terms',
  );
  add(25, () => ({ query: w(8000, 20000) }), 'rare');
  // Ranks 0..19 are "the", "of", "and"...: the worst case, matching almost every note.
  add(
    20,
    (i) => ({ query: i < 12 ? (VOCAB[i] as string) : `${VOCAB[i - 12]} ${VOCAB[i - 11]}` }),
    'common',
  );
  add(25, (i) => ({ query: `${(w(20, 3000) + 'xyz').slice(0, i % 2 ? 4 : 3)}*` }), 'prefix');
  add(
    25,
    (i) => ({
      query: i < 15 ? `"${PHRASE_LIST[i % PHRASE_LIST.length]}"` : `"${w(0, 40)} ${w(0, 40)}"`,
    }),
    'phrase',
  );
  add(15, (i) => ({ query: w(20, 600), tag: TAG_POOL[i % 12] as string }), 'tag');
  add(10, (i) => ({ query: w(20, 600), folder: i % 3 }), 'folder');
  add(
    10,
    (i) => ({
      query: w(20, 600),
      createdFrom: BASE_TIME + i * 30 * DAY,
      createdTo: BASE_TIME + (i + 6) * 30 * DAY,
    }),
    'date',
  );
  add(10, () => ({ query: `${w(20, 300)} -${w(20, 300)}` }), 'exclude');
  return out;
}
