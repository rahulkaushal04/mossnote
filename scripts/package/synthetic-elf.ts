/** A tiny 64-bit ELF file whose version-needs section lists `needs`, for tests. */
export function syntheticElf(needs: Record<string, string[]>): Buffer {
  const names = ['', ...Object.keys(needs), ...Object.values(needs).flat()];
  const strings = Buffer.from(`${names.join('\0')}\0`, 'latin1');
  const at = (text: string) => strings.indexOf(`\0${text}\0`) + 1;
  const entries = Object.entries(needs);
  const verneed = Buffer.alloc(
    entries.reduce((sum, [, versions]) => sum + 16 + 16 * versions.length, 0),
  );
  let offset = 0;
  entries.forEach(([library, versions], entry) => {
    const size = 16 + 16 * versions.length;
    verneed.writeUInt16LE(1, offset);
    verneed.writeUInt16LE(versions.length, offset + 2);
    verneed.writeUInt32LE(at(library), offset + 4);
    verneed.writeUInt32LE(16, offset + 8);
    verneed.writeUInt32LE(entry === entries.length - 1 ? 0 : size, offset + 12);
    versions.forEach((version, index) => {
      const aux = offset + 16 + index * 16;
      verneed.writeUInt32LE(at(version), aux + 8);
      verneed.writeUInt32LE(index === versions.length - 1 ? 0 : 16, aux + 12);
    });
    offset += size;
  });

  const stringsAt = 64;
  const verneedAt = stringsAt + strings.length;
  const tableAt = verneedAt + verneed.length;
  const file = Buffer.alloc(tableAt + 3 * 64);
  file.writeUInt32BE(0x7f454c46, 0);
  file[4] = 2;
  file[5] = 1;
  file.writeBigUInt64LE(BigInt(tableAt), 0x28);
  file.writeUInt16LE(64, 0x3a);
  file.writeUInt16LE(3, 0x3c);
  strings.copy(file, stringsAt);
  verneed.copy(file, verneedAt);
  const section = (
    index: number,
    type: number,
    at: number,
    size: number,
    link: number,
    info: number,
  ) => {
    const header = tableAt + index * 64;
    file.writeUInt32LE(type, header + 4);
    file.writeBigUInt64LE(BigInt(at), header + 0x18);
    file.writeBigUInt64LE(BigInt(size), header + 0x20);
    file.writeUInt32LE(link, header + 0x28);
    file.writeUInt32LE(info, header + 0x2c);
  };
  section(1, 3, stringsAt, strings.length, 0, 0);
  section(2, 0x6ffffffe, verneedAt, verneed.length, 1, entries.length);
  return file;
}
