/**
 * Drives a single screen/window recording from the renderer.
 *
 * MediaRecorder emits fragmented-MP4 chunks (the first carries the init/moov,
 * the rest are moof+mdat fragments that concatenate into a valid file). Each
 * chunk is streamed to the main process, which persists it through the durable,
 * unit-tested SegmentWriter. Encoding runs in Chromium's media pipeline, off the
 * UI thread; the only main-thread work here is handing bytes to IPC. See
 * ADR-0005 for why this uses MediaRecorder rather than WebCodecs+mp4box.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

function pickMimeType(): string | null {
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

interface DesktopVideoConstraints {
  mandatory: {
    chromeMediaSource: 'desktop';
    chromeMediaSourceId: string;
    maxFrameRate?: number;
  };
}

export interface RecorderCallbacks {
  onSegmentCount(count: number): void;
  onError(message: string): void;
}

const TIMESLICE_MS = 1000;

export class StreamRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recordingId: string | null = null;
  private lastChunkAt = 0;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly callbacks: RecorderCallbacks) {}

  async start(sourceId: string, targetFps: number): Promise<void> {
    const constraints: DesktopVideoConstraints = {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxFrameRate: targetFps,
      },
    };
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: constraints as unknown as MediaTrackConstraints,
    });

    const { recordingId } = await window.novarec.startRecording({ trackKind: 'video' });
    this.recordingId = recordingId;

    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (event) => this.enqueueChunk(event.data);
    this.recorder.onerror = () => this.callbacks.onError('The recorder reported an error');
    this.lastChunkAt = performance.now();
    this.recorder.start(TIMESLICE_MS);
  }

  private enqueueChunk(blob: Blob): void {
    const recordingId = this.recordingId;
    if (!recordingId || blob.size === 0) return;
    const now = performance.now();
    const durationMs = Math.max(0, now - this.lastChunkAt);
    this.lastChunkAt = now;

    // Serialize writes so fragments reach main in capture order.
    this.writeQueue = this.writeQueue.then(async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { segmentCount } = await window.novarec.writeFragment({
          recordingId,
          bytes,
          durationMs,
        });
        this.callbacks.onSegmentCount(segmentCount);
      } catch (error) {
        this.callbacks.onError(
          error instanceof Error ? error.message : 'Failed to write a segment',
        );
      }
    });
  }

  async pause(): Promise<void> {
    this.recorder?.pause();
    if (this.recordingId) {
      await window.novarec.pauseRecording({
        recordingId: this.recordingId,
        atMs: performance.now(),
      });
    }
  }

  async resume(): Promise<void> {
    if (this.recordingId) {
      await window.novarec.resumeRecording({
        recordingId: this.recordingId,
        atMs: performance.now(),
      });
    }
    this.lastChunkAt = performance.now();
    this.recorder?.resume();
  }

  async stop(): Promise<string | null> {
    const recorder = this.recorder;
    const recordingId = this.recordingId;
    if (!recorder || !recordingId) return null;

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    await this.writeQueue; // flush all pending fragment writes
    const summary = await window.novarec.stopRecording({ recordingId, atMs: performance.now() });
    this.cleanup();
    return summary.recordingId;
  }

  private cleanup(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
    this.recordingId = null;
  }
}
