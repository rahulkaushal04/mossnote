const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const MASK80 = (1n << 80n) - 1n;

export type RandomBytes = (n: number) => Uint8Array;
const defaultRandom: RandomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** ULID generator: 48-bit ms + 80 random bits, strictly increasing even within one ms or when
 *  the wall clock goes backwards (time is clamped to the last issued ms). */
export function createUlid(now: () => number, random: RandomBytes = defaultRandom): () => string {
  let lastMs = -1;
  let lastRand = 0n;
  return () => {
    const ms = Math.max(now(), lastMs);
    let rand: bigint;
    if (ms === lastMs) {
      rand = lastRand + 1n;
      if (rand > MASK80) throw new Error('ULID random part overflow');
    } else {
      rand = random(10).reduce((a, b) => (a << 8n) | BigInt(b), 0n);
    }
    lastMs = ms;
    lastRand = rand;
    let v = (BigInt(ms) << 80n) | rand;
    let out = '';
    for (let i = 0; i < 26; i++) {
      out = ALPHABET[Number(v & 31n)] + out;
      v >>= 5n;
    }
    return out;
  };
}
