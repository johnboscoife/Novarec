import { join } from 'node:path';
import { SEGMENT_TARGET_DURATION_MS, type RecordingStatus } from '@novarec/shared';
import { DiskFullError, isDiskFull, nodeDisk, type DiskIO } from './disk.js';
import {
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  reduceEvents,
  serializeEvent,
  type ManifestEvent,
  type ManifestState,
} from './manifest.js';

const encoder = new TextEncoder();

function segmentName(index: number): string {
  return `seg-${String(index).padStart(6, '0')}.mp4`;
}

export interface SegmentWriterOptions {
  dir: string;
  recordingId: string;
  createdAt: string;
  trackKind?: 'video' | 'audio';
  disk?: DiskIO;
  targetDurationMs?: number;
}

interface OpenSegment {
  index: number;
  bytes: number;
  durationMs: number;
}

/**
 * Writes captured fragments to ~2s fragmented-MP4 segments, each fsync'd and
 * sealed via the append-only manifest. Sealed segments are immutable; the most
 * a crash can lose is the in-flight unsealed segment. Pause seals the current
 * segment; resume opens a fresh one on the next fragment.
 */
export class SegmentWriter {
  private readonly dir: string;
  private readonly disk: DiskIO;
  private readonly targetDurationMs: number;
  private readonly recordingId: string;
  private readonly createdAt: string;
  private readonly trackKind: 'video' | 'audio';
  private readonly manifestPath: string;

  private readonly events: ManifestEvent[] = [];
  private nextIndex = 0;
  private sealed = 0;
  private elapsedMs = 0;
  private open: OpenSegment | null = null;
  private initSegment: string | null = null;
  private failed = false;
  private started = false;
  /**
   * Every public operation runs through this chain, one at a time. The main
   * process handles IPC calls concurrently, so without it a `pause` could seal
   * a segment while a `writeFragment` was still between opening it and writing
   * into it — dropping that fragment and leaving a sealed segment whose file
   * was never created. A failed operation must not poison the ones behind it.
   */
  private queue: Promise<unknown> = Promise.resolve();

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => undefined);
    return run;
  }

  constructor(options: SegmentWriterOptions) {
    this.dir = options.dir;
    this.disk = options.disk ?? nodeDisk;
    this.targetDurationMs = options.targetDurationMs ?? SEGMENT_TARGET_DURATION_MS;
    this.recordingId = options.recordingId;
    this.createdAt = options.createdAt;
    this.trackKind = options.trackKind ?? 'video';
    this.manifestPath = join(this.dir, MANIFEST_FILENAME);
  }

  get state(): ManifestState {
    return reduceEvents(this.events);
  }

  /** Sealed-segment count, tracked incrementally (avoids reducing the whole
   * manifest on every fragment during a long recording). */
  get sealedSegmentCount(): number {
    return this.sealed;
  }

  /** Idempotent: an init and a first fragment can both ask to start the track. */
  start(initBytes?: Uint8Array): Promise<void> {
    return this.serial(async () => {
      if (this.started) return;
      await this.startNow(initBytes);
      this.started = true;
    });
  }

  private async startNow(initBytes?: Uint8Array): Promise<void> {
    await this.disk.mkdir(this.dir);
    if (initBytes) {
      this.initSegment = 'init.mp4';
      await this.disk.writeAndSync(join(this.dir, this.initSegment), initBytes);
    }
    await this.append({
      type: 'start',
      version: MANIFEST_VERSION,
      recordingId: this.recordingId,
      createdAt: this.createdAt,
      trackKind: this.trackKind,
      initSegment: this.initSegment,
    });
  }

  writeFragment(bytes: Uint8Array, durationMs: number): Promise<void> {
    return this.serial(() => this.writeFragmentNow(bytes, durationMs));
  }

  private async writeFragmentNow(bytes: Uint8Array, durationMs: number): Promise<void> {
    // Only a genuine disk-full is terminal. A transient error (the append layer
    // already retried past a passing lock) loses at most this one ~1s fragment;
    // the track stays alive and keeps recording rather than being torn down.
    if (this.failed) throw new DiskFullError();
    try {
      if (!this.open) await this.openSegment();
      const segment = this.open;
      if (!segment) return;
      await this.disk.appendAndSync(join(this.dir, segmentName(segment.index)), bytes);
      segment.bytes += bytes.byteLength;
      segment.durationMs += durationMs;
      this.elapsedMs += durationMs;
      if (segment.durationMs >= this.targetDurationMs) await this.sealOpen();
    } catch (error) {
      if (isDiskFull(error)) {
        this.failed = true;
        throw new DiskFullError(error);
      }
      // Transient/non-fatal: surface it, but don't set `failed` (so the next
      // fragment retries) and don't disguise it as DiskFullError (which would
      // finalize every sibling track).
      throw error;
    }
  }

  pause(atMs: number): Promise<void> {
    return this.serial(async () => {
      if (this.open) await this.sealOpen();
      await this.append({ type: 'pause', atMs });
    });
  }

  resume(atMs: number): Promise<void> {
    return this.serial(() => this.append({ type: 'resume', atMs }));
  }

  /**
   * Finalizes the recording. Best-effort and never throws — even a disk-full
   * stop should leave a clean, replayable manifest rather than blow up.
   */
  stop(atMs: number, status: RecordingStatus = 'ready'): Promise<ManifestState> {
    return this.serial(async () => {
      try {
        if (this.open) await this.sealOpen();
        await this.append({ type: 'stop', atMs, status });
      } catch {
        // Swallow: sealed segments and prior manifest lines are already durable.
      }
      return this.state;
    });
  }

  /**
   * The manifest line is written BEFORE the segment counts as open. If that
   * write fails, no fragment may land in a file the manifest never announced —
   * recovery would ignore it, and its later seal, as belonging to no segment.
   */
  private async openSegment(): Promise<void> {
    const index = this.nextIndex;
    await this.append({
      type: 'segment-open',
      index,
      path: segmentName(index),
      startMs: this.elapsedMs,
    });
    this.nextIndex += 1;
    this.open = { index, bytes: 0, durationMs: 0 };
  }

  /**
   * Likewise the seal is written BEFORE the segment stops being open: if it
   * fails, the segment stays open and the next seal (by size, pause or stop)
   * records it, rather than leaving a complete segment that is never sealed.
   */
  private async sealOpen(): Promise<void> {
    const segment = this.open;
    if (!segment) return;
    await this.append({
      type: 'segment-seal',
      index: segment.index,
      durationMs: segment.durationMs,
      bytes: segment.bytes,
    });
    this.open = null;
    this.sealed += 1;
  }

  private async append(event: ManifestEvent): Promise<void> {
    await this.disk.appendAndSync(this.manifestPath, encoder.encode(serializeEvent(event)));
    this.events.push(event);
  }
}
