import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/**
 * One file that holds a folder: a gzip stream of `[4-byte index length][JSON index][file bytes…]`.
 * It exists so the standalone program can carry the whole app inside itself and unpack it with
 * nothing but Node's own modules. No symbolic links, no permissions beyond "runnable".
 */
export interface ArchiveFile {
  /** Path inside the archive, with `/` separators. */
  path: string;
  /** True for files that must stay runnable (the native module has no such need, but scripts do). */
  executable: boolean;
  data: Buffer;
}

interface IndexEntry {
  path: string;
  executable: boolean;
  size: number;
}

export function pack(files: readonly ArchiveFile[]): Buffer {
  const index: IndexEntry[] = files.map((f) => ({
    path: f.path,
    executable: f.executable,
    size: f.data.length,
  }));
  const header = Buffer.from(JSON.stringify(index));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return zlib.gzipSync(Buffer.concat([length, header, ...files.map((f) => f.data)]), { level: 9 });
}

/** A path that stays inside the folder it is unpacked into. */
function isSafe(entry: string): boolean {
  if (entry === '' || entry.includes('\0') || entry.includes('\\')) return false;
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false;
  return entry.split('/').every((part) => part !== '' && part !== '..' && part !== '.');
}

export function unpack(archive: Buffer): ArchiveFile[] {
  const raw = zlib.gunzipSync(archive);
  const headerLength = raw.readUInt32LE(0);
  const index = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8')) as IndexEntry[];
  let offset = 4 + headerLength;
  return index.map((entry) => {
    if (!isSafe(entry.path)) throw new Error(`The archive holds an unsafe path: ${entry.path}`);
    const data = raw.subarray(offset, offset + entry.size);
    offset += entry.size;
    return { path: entry.path, executable: entry.executable, data };
  });
}

/** Write every file under `destination`, which is created if needed. */
export function extract(archive: Buffer, destination: string): void {
  for (const file of unpack(archive)) {
    const target = path.join(destination, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.data, { mode: file.executable ? 0o755 : 0o644 });
  }
}

/** Read a folder into archive entries, skipping symbolic links and anything `skip` rejects. */
export function readFolder(
  root: string,
  skip: (relative: string) => boolean = () => false,
): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      const relative = path.relative(root, full).split(path.sep).join('/');
      if (skip(relative) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files.push({
          path: relative,
          executable: (fs.statSync(full).mode & 0o111) !== 0,
          data: fs.readFileSync(full),
        });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
