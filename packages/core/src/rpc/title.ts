import { MAX_TITLE } from './contract.ts';

/** First line with text, minus leading BOM, `#` marks and spaces; capped at 200 code points. */
export function deriveTitle(body: string): string {
  for (const line of body.split(/\r\n|\r|\n/)) {
    const t = line
      .replace(/^\s+/, '')
      .replace(/^[#\s]+/, '')
      .trimEnd();
    if (t) return [...t].slice(0, MAX_TITLE).join('');
  }
  return '';
}
