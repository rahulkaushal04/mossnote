/**
 * Subsequence match with bonuses for the first character, word starts and consecutive runs.
 * Returns null when `query` is not a subsequence of `text`, else a score (higher is better).
 * shortcut: greedy left-most match, not the optimal alignment; fine for titles, revisit for long text.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  let score = 0;
  let prev = -2;
  let pos = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, pos);
    if (i < 0) return null;
    const boundary = i === 0 || /[\s\-_./]/.test(t[i - 1]!);
    score +=
      1 + (i === 0 ? 8 : boundary ? 5 : 0) + (i === prev + 1 ? 4 : 0) - Math.min(i - pos, 3) * 0.5;
    prev = i;
    pos = i + 1;
  }
  return score - t.length * 0.01;
}
