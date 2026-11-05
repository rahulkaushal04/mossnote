export function mulberry32(a: number): () => number {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = [...'abcdefghij klmnopqrstuvwxyz\n,.é日本語🌿😀'];
/** Deterministic text for a seed; includes multi-byte and astral characters (typed per code point). */
export function seededText(seed: number, length = 2000): string {
  const r = mulberry32(seed);
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(r() * ALPHABET.length)];
  return s;
}
