/**
 * The only two normalisations applied to stored text (spec section 19): CRLF becomes LF, and NUL
 * characters are removed. Nothing is HTML-sanitised on write.
 */
export function cleanText(value: string): string {
  return value.replaceAll('\r\n', '\n').replaceAll('\0', '');
}

/** Lowercase, NFC, diacritics removed: the form used to compare words for search. */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFC')
    .toLowerCase();
}

/** `n` with thousands separators, for messages such as "Too long: 50,001 of 50,000 characters." */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}

/** The first `max` characters of a body, for labels of notes without a title. */
export function firstChars(body: string, max = 60): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

/** "farm entry" to "Farm entry". */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** "crop" to "a crop", "entry" to "an entry". */
export const a = (noun: string): string => `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
