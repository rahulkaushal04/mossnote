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

  if (rowA.length < lb + 1) {
    rowA = new Int32Array(lb + 1);
    rowB = new Int32Array(lb + 1);
    rowC = new Int32Array(lb + 1);
  }
  let prev2 = rowA;
  let prev = rowB;
  let row = rowC;
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    row[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    const caPrev = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let value = (prev[j - 1] ?? 0) + (ca === cb ? 0 : 1);
      const del = (prev[j] ?? 0) + 1;
      if (del < value) value = del;
      const ins = (row[j - 1] ?? 0) + 1;
      if (ins < value) value = ins;
      if (j > 1 && ca === b.charCodeAt(j - 2) && caPrev === cb) {
        const swap = (prev2[j - 2] ?? 0) + 1;
        if (swap < value) value = swap;
      }
      row[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    const spare = prev2;
    prev2 = prev;
    prev = row;
    row = spare;
  }
  const result = prev[lb] ?? 0;
  return result > max ? max + 1 : result;
}

let rowA = new Int32Array(64);
let rowB = new Int32Array(64);
let rowC = new Int32Array(64);

/** Maximum edits allowed for a term: none under 4 characters, 1 for 4 to 7, 2 for 8 or more. */
export function allowedEdits(term: string): number {
  if (term.length < 4) return 0;
  return term.length < 8 ? 1 : 2;
}
