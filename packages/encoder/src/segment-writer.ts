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
  private elapsedMs = 0;
  private open: OpenSegment | null = null;
  private initSegment: string | null = null;
  private failed = false;

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

  async start(initBytes?: Uint8Array): Promise<void> {
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

  async writeFragment(bytes: Uint8Array, durationMs: number): Promise<void> {
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
      this.failed = true;
      if (isDiskFull(error)) throw new DiskFullError(error);
      throw error;
    }
  }

  async pause(atMs: number): Promise<void> {
    if (this.open) await this.sealOpen();
    await this.append({ type: 'pause', atMs });
  }

  async resume(atMs: number): Promise<void> {
    await this.append({ type: 'resume', atMs });
  }

  /**
   * Finalizes the recording. Best-effort and never throws — even a disk-full
   * stop should leave a clean, replayable manifest rather than blow up.
   */
  async stop(atMs: number, status: RecordingStatus = 'ready'): Promise<ManifestState> {
    try {
      if (this.open) await this.sealOpen();
      await this.append({ type: 'stop', atMs, status });
    } catch {
      // Swallow: sealed segments and prior manifest lines are already durable.
    }
    return this.state;
  }

  private async openSegment(): Promise<void> {
    const index = this.nextIndex;
    this.nextIndex += 1;
    this.open = { index, bytes: 0, durationMs: 0 };
    await this.append({
      type: 'segment-open',
      index,
      path: segmentName(index),
      startMs: this.elapsedMs,
    });
  }

  private async sealOpen(): Promise<void> {
    const segment = this.open;
    if (!segment) return;
    this.open = null;
    await this.append({
      type: 'segment-seal',
      index: segment.index,
      durationMs: segment.durationMs,
      bytes: segment.bytes,
    });
  }

  private async append(event: ManifestEvent): Promise<void> {
    await this.disk.appendAndSync(this.manifestPath, encoder.encode(serializeEvent(event)));
    this.events.push(event);
  }
}
