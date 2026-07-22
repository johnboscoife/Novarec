import { mkdir, open, readFile, readdir, stat } from 'node:fs/promises';

/**
 * Durable disk operations behind an interface so tests can inject failures
 * (e.g. ENOSPC for the disk-full path). Writes are always followed by an
 * fsync — a segment or manifest line is only "durable" once it's on the platter.
 */
export interface DiskIO {
  mkdir(dir: string): Promise<void>;
  /** Overwrite a file and fsync it. */
  writeAndSync(path: string, data: Uint8Array): Promise<void>;
  /** Append to a file and fsync it. */
  appendAndSync(path: string, data: Uint8Array): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  readText(path: string): Promise<string>;
  readdir(dir: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
}

export const nodeDisk: DiskIO = {
  async mkdir(dir) {
    await mkdir(dir, { recursive: true });
  },
  async writeAndSync(path, data) {
    const fh = await open(path, 'w');
    try {
      await fh.write(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
  async appendAndSync(path, data) {
    const fh = await open(path, 'a');
    try {
      await fh.write(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
  },
  async readFile(path) {
    return readFile(path);
  },
  async readText(path) {
    return readFile(path, 'utf8');
  },
  async readdir(dir) {
    return readdir(dir);
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
};

/** Raised when the disk is full; the session turns this into a graceful stop. */
export class DiskFullError extends Error {
  constructor(cause?: unknown) {
    super('Disk is full — recording stopped to protect existing segments');
    this.name = 'DiskFullError';
    this.cause = cause;
  }
}

export function isDiskFull(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOSPC'
  );
}
