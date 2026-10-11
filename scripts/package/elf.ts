/** The shared-library versions an ELF file asks of its system (`.gnu.version_r`). 64-bit, little-endian. */

const SHT_GNU_VERNEED = 0x6ffffffe;

export type VersionNeeds = Record<string, string[]>;

function cString(buffer: Buffer, offset: number): string {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end++;
  return buffer.toString('latin1', offset, end);
}

export function isElf(buffer: Buffer): boolean {
  return buffer.length > 64 && buffer.readUInt32BE(0) === 0x7f454c46;
}

export function versionNeeds(buffer: Buffer): VersionNeeds {
  if (!isElf(buffer) || buffer[4] !== 2 || buffer[5] !== 1) {
    throw new Error('Not a 64-bit little-endian ELF file.');
  }
  const sectionTable = Number(buffer.readBigUInt64LE(0x28));
  const entrySize = buffer.readUInt16LE(0x3a);
  const count = buffer.readUInt16LE(0x3c);
  const needs: VersionNeeds = {};
  for (let index = 0; index < count; index++) {
    const header = sectionTable + index * entrySize;
    if (buffer.readUInt32LE(header + 4) !== SHT_GNU_VERNEED) continue;
    const offset = Number(buffer.readBigUInt64LE(header + 0x18));
    const link = buffer.readUInt32LE(header + 0x28);
    const entries = buffer.readUInt32LE(header + 0x2c);
    const strings = sectionTable + link * entrySize;
    const stringsAt = Number(buffer.readBigUInt64LE(strings + 0x18));

    let need = offset;
    for (let n = 0; n < entries; n++) {
      const library = cString(buffer, stringsAt + buffer.readUInt32LE(need + 4));
      const versions: string[] = [];
      let aux = need + buffer.readUInt32LE(need + 8);
      for (let a = 0; a < buffer.readUInt16LE(need + 2); a++) {
        versions.push(cString(buffer, stringsAt + buffer.readUInt32LE(aux + 8)));
        aux += buffer.readUInt32LE(aux + 12) || 0;
      }
      needs[library] = [...(needs[library] ?? []), ...versions];
      need += buffer.readUInt32LE(need + 12);
    }
  }
  return needs;
}

/** `[2, 34]` for `GLIBC_2.34`. */
export function versionOf(name: string, prefix: string): number[] | null {
  const match = new RegExp(`^${prefix}_(\\d+(?:\\.\\d+)*)$`).exec(name);
  return match ? (match[1] ?? '').split('.').map(Number) : null;
}

export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The newest `<prefix>_x.y` among the needs, or null. */
export function highest(needs: VersionNeeds, prefix: string): string | null {
  let best: number[] | null = null;
  for (const names of Object.values(needs)) {
    for (const name of names) {
      const version = versionOf(name, prefix);
      if (version && (!best || compareVersions(version, best) > 0)) best = version;
    }
  }
  return best ? best.join('.') : null;
}

export function atMost(version: string | null, limit: string): boolean {
  return (
    version === null ||
    compareVersions(version.split('.').map(Number), limit.split('.').map(Number)) <= 0
  );
}
