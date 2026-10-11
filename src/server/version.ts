import fs from 'node:fs';

/**
 * The version of the app that is running, read from the `package.json` that ships with it: the
 * npm package, the unpacked standalone program and a source checkout all have one in the same
 * place. It is never taken from the environment, because `npm_package_version` names whichever
 * package started the process (running `mossnote` inside another project's npm script would
 * report that project's version).
 */
export function readAppVersion(packageJson: URL): string {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJson, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed) {
      const { version } = parsed;
      if (typeof version === 'string' && version !== '') return version;
    }
  } catch {
    // Reported as unknown below.
  }
  return 'unknown';
}
