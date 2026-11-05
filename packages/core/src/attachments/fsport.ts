import * as nodeFsApi from 'node:fs';

export interface BlobStat {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  isFile: boolean;
}

/**
 * The attachments module's own file port (the shared FsPort has no streaming primitives). Tests wrap
 * it to inject ENOSPC/EIO on the Nth write. All calls are synchronous and chunk-sized; the callers
 * yield to the event loop between chunks.
 */
export interface AttachFs {
  mkdirp(dir: string): void;
  exists(path: string): boolean;
  /** Existing file, read-only, never blocks on a FIFO. */
  openRead(path: string): number;
  /** New file, exclusive create, owner read/write only (never executable). */
  openNew(path: string): number;
  fstat(fd: number): BlobStat;
  stat(path: string): BlobStat;
  /** Reads up to `len` bytes at `pos` (or the current position when undefined). */
  read(fd: number, buf: Uint8Array, len: number, pos?: number): number;
  /** Must write all `len` bytes or throw. */
  write(fd: number, buf: Uint8Array, len: number): void;
  fsync(fd: number): void;
  close(fd: number): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  /** fsync of a directory so a rename survives power loss. Best effort on platforms that refuse it. */
  fsyncDir(path: string): void;
  readdir(path: string): string[];
  /** Free bytes on the volume of `path`, undefined when unknown. */
  freeBytes(path: string): number | undefined;
}

const toStat = (s: nodeFsApi.Stats): BlobStat => ({
  size: s.size,
  mtimeMs: s.mtimeMs,
  ctimeMs: s.ctimeMs,
  dev: s.dev,
  ino: s.ino,
  isFile: s.isFile(),
});

export const nodeAttachFs: AttachFs = {
  mkdirp: (d) => void nodeFsApi.mkdirSync(d, { recursive: true, mode: 0o700 }),
  exists: (p) => nodeFsApi.existsSync(p),
  openRead: (p) => nodeFsApi.openSync(p, nodeFsApi.constants.O_RDONLY | nodeFsApi.constants.O_NONBLOCK),
  openNew: (p) => nodeFsApi.openSync(p, 'wx', 0o600),
  fstat: (fd) => toStat(nodeFsApi.fstatSync(fd)),
  stat: (p) => toStat(nodeFsApi.statSync(p)),
  read: (fd, buf, len, pos) => nodeFsApi.readSync(fd, buf, 0, len, pos ?? null),
  write(fd, buf, len) {
    let off = 0;
    while (off < len) off += nodeFsApi.writeSync(fd, buf, off, len - off);
  },
  fsync: (fd) => nodeFsApi.fsyncSync(fd),
  close: (fd) => nodeFsApi.closeSync(fd),
  rename: (a, b) => nodeFsApi.renameSync(a, b),
  unlink: (p) => nodeFsApi.unlinkSync(p),
  fsyncDir(p) {
    try {
      const fd = nodeFsApi.openSync(p, 'r');
      try {
        nodeFsApi.fsyncSync(fd);
      } finally {
        nodeFsApi.closeSync(fd);
      }
    } catch {
      /* some platforms cannot fsync a directory; the rename itself is already atomic */
    }
  },
  readdir: (p) => nodeFsApi.readdirSync(p),
  freeBytes(p) {
    try {
      const s = nodeFsApi.statfsSync(p);
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return undefined;
    }
  },
};
