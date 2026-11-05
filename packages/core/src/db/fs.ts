import * as nodeFsApi from 'node:fs';

export interface FileStat {
  dev: number;
  ino: number;
  birthtimeMs: number;
  size: number;
}
/** The only place core touches node:fs, so tests can inject ENOSPC/EIO. */
export interface FsPort {
  mkdirp(dir: string): void;
  exists(path: string): boolean;
  copyFile(src: string, dst: string): void;
  fsyncPath(path: string): void;
  rename(from: string, to: string): void;
  unlink(path: string): void;
  stat(path: string): FileStat;
}

export const nodeFs: FsPort = {
  mkdirp: (dir) => void nodeFsApi.mkdirSync(dir, { recursive: true }),
  exists: (p) => nodeFsApi.existsSync(p),
  copyFile: (a, b) => nodeFsApi.copyFileSync(a, b),
  fsyncPath(p) {
    const fd = nodeFsApi.openSync(p, 'r');
    try {
      nodeFsApi.fsyncSync(fd);
    } finally {
      nodeFsApi.closeSync(fd);
    }
  },
  rename: (a, b) => nodeFsApi.renameSync(a, b),
  unlink: (p) => nodeFsApi.unlinkSync(p),
  stat(p) {
    const s = nodeFsApi.statSync(p);
    return { dev: s.dev, ino: s.ino, birthtimeMs: s.birthtimeMs, size: s.size };
  },
};
