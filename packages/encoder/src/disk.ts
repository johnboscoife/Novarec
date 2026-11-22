import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

// A transient file lock (antivirus scan, Windows Search indexer, OneDrive sync)
// briefly fails an open/write with EBUSY/EPERM/EACCES on the very machines we
// target. Retrying with a short backoff rides over it instead of killing the
// track — but ENOSPC is genuinely fatal and must never be retried.
const APPEND_RETRIES = 4;
const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * fsync a directory, so a file just created or renamed in it is durably
 * NAMED there. fsync on the file makes its bytes durable, but on ext4/APFS the
 * directory entry pointing at it can still be lost to a power cut.
 *
 * Best-effort: Windows cannot open a directory this way (NTFS journals its
 * metadata anyway), so any failure is ignored rather than failing the write.
 */
async function syncDir(dir: string): Promise<void> {
  try {
    const fh = await open(dir, 'r');
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
  } catch {
    // not supported on this platform/filesystem
  }
}

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
  /**
   * Concatenate many input files into one output file, streaming one input at a
   * time so peak memory stays bounded to a single segment — a multi-hour track is
   * gigabytes and must never be materialized whole (that OOMs / hits Node's
   * ~2 GiB Buffer limit). fsync'd once at the end.
   */
  concatToFile(outputPath: string, inputPaths: string[]): Promise<void>;
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
    await syncDir(dirname(path));
  },
  async concatToFile(outputPath, inputPaths) {
    // Build in a temp sibling and rename into place, never in the destination
    // itself. Opening the destination 'w' truncates it INSTANTLY and then
    // refills it over seconds: anything reading that path in the meantime (an
    // export already running against this recording, a media player) sees a
    // truncated file and fails mid-stream. A crash halfway through would leave
    // the same wreckage behind permanently.
    const tempPath = `${outputPath}.tmp-${randomUUID()}`;
    try {
      const out = await open(tempPath, 'w');
      try {
        for (const input of inputPaths) {
          // Stream each source file through a bounded buffer rather than reading
          // the whole segment (let alone the whole track) into memory at once.
          const src = await open(input, 'r');
          try {
            const chunk = Buffer.allocUnsafe(1024 * 1024);
            for (;;) {
              const { bytesRead } = await src.read(chunk, 0, chunk.length, null);
              if (bytesRead === 0) break;
              await out.write(chunk.subarray(0, bytesRead));
            }
          } finally {
            await src.close();
          }
        }
        await out.sync();
      } finally {
        await out.close();
      }
      await rename(tempPath, outputPath);
      await syncDir(dirname(outputPath));
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  },
  async appendAndSync(path, data) {
    for (let attempt = 1; ; attempt += 1) {
      let fh;
      try {
        fh = await open(path, 'a');
      } catch (error) {
        // Nothing was written — safe to retry a transient lock.
        if (isDiskFull(error) || attempt >= APPEND_RETRIES) throw error;
        await delay(40 * attempt);
        continue;
      }
      try {
        // Snapshot the size so a partial append can be rolled back before a
        // retry — otherwise a second attempt would duplicate bytes and corrupt
        // the fragment.
        const { size } = await fh.stat();
        try {
          await fh.write(data);
          await fh.sync();
          // A first write means the file was just created (a new segment, or
          // the manifest itself): make its directory entry durable too.
          if (size === 0) await syncDir(dirname(path));
          return;
        } catch (error) {
          await fh.truncate(size).catch(() => undefined);
          if (isDiskFull(error) || attempt >= APPEND_RETRIES) throw error;
          await delay(40 * attempt);
        }
      } finally {
        await fh.close().catch(() => undefined);
      }
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
