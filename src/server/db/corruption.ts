const CORRUPTION_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB', 'SQLITE_CORRUPT_VTAB']);

/** SQLite reports a damaged file either from `integrity_check` or as an error while opening it. */
export function isCorruption(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CORRUPTION_CODES.has(code);
}
