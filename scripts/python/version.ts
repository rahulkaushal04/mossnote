const PRERELEASE = /^(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.(\d+))?$/;
const SHORT: Record<string, string> = { alpha: 'a', beta: 'b', rc: 'rc' };

/** `0.1.0-beta.1` becomes `0.1.0b1`; `1.2.3` stays. Anything else is refused. */
export function toPep440(version: string): string {
  const match = PRERELEASE.exec(version);
  if (!match) {
    throw new Error(
      `"${version}" cannot be written as a Python version. Use X.Y.Z or X.Y.Z-(alpha|beta|rc).N.`,
    );
  }
  const [, release = '', kind, number] = match;
  return kind === undefined ? release : `${release}${SHORT[kind] ?? ''}${number ?? ''}`;
}
