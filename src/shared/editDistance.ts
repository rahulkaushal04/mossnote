/**
 * Damerau-Levenshtein distance (adjacent transpositions count as one edit) with an early exit:
 * returns `max + 1` as soon as the distance is certain to exceed `max`. Used for typo tolerance
 * (spec section 16); a scan of 30,000 vocabulary terms must stay under about 10 ms.
 */
export function boundedDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb <= max ? lb : max + 1;
  if (lb === 0) return la <= max ? la : max + 1;

  let prev2: number[] = new Array<number>(lb + 1).fill(0);
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const row: number[] = new Array<number>(lb + 1);
    row[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      let value = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        value = Math.min(value, (prev2[j - 2] ?? 0) + 1);
      }
      row[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  const result = prev[lb] ?? max + 1;
  return result > max ? max + 1 : result;
}

/** Maximum edits allowed for a term: none under 4 characters, 1 for 4 to 7, 2 for 8 or more. */
export function allowedEdits(term: string): number {
  if (term.length < 4) return 0;
  return term.length < 8 ? 1 : 2;
}
