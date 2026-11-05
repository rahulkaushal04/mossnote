import { Fragment } from 'react';

export interface Marked {
  text: string;
  ranges: Array<[number, number]>;
}

/** Sorted, clamped, non-overlapping [start,end) pieces. Bad ranges (NaN, reversed, outside) are dropped. */
export function segments(m: Marked): { text: string; mark: boolean }[] {
  const n = m.text.length;
  const rs = m.ranges
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b))
    .map(([a, b]) => [Math.max(0, a), Math.min(n, b)] as const)
    .filter(([a, b]) => a < b)
    .sort((x, y) => x[0] - y[0]);
  const out: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const [a, b] of rs) {
    const from = Math.max(a, at);
    if (b <= from) continue;
    if (from > at) out.push({ text: m.text.slice(at, from), mark: false });
    out.push({ text: m.text.slice(from, b), mark: true });
    at = b;
  }
  if (at < n) out.push({ text: m.text.slice(at), mark: false });
  return out;
}

/** Text and `<mark>` elements only: the note text is never parsed as markup . */
export function Highlighted({ value }: { value: Marked }) {
  return (
    <>
      {segments(value).map((s, i) =>
        s.mark ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  );
}
