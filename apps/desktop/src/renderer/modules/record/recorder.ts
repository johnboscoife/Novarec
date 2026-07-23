import type { TrackConfig } from '@novarec/shared';

/**
 * Multi-track recording from the renderer. Each enabled track (screen, camera,
 * mic, system audio) gets its own MediaStream and MediaRecorder and streams
 * fragmented-MP4 chunks to main, which persists each as an independent, durable
 * track (they stay separate until export). Encoding runs in Chromium's media
 * pipeline, off the UI thread. See ADR-0005 (MediaRecorder) and ADR-0006
 * (per-track writers).
 */
const VIDEO_MIME = [
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];
const AUDIO_MIME = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
const TIMESLICE_MS = 1000;

function pickMime(candidates: string[]): string | null {
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

/**
 * Acquire a stream for one track. Screen uses the modern `getDisplayMedia`
 * (main routes it to the chosen source via `capture:setSource`); camera/mic use
 * `getUserMedia`; system audio uses a loopback display-media request, keeping
 * only its audio track.
 */
async function acquireStream(
  config: TrackConfig,
  targetFps: number,
  screenSourceId: string | null,
): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  switch (config.kind) {
    case 'screen': {
      await window.novarec.setCaptureSource({ sourceId: config.sourceId ?? null, audio: false });
      return media.getDisplayMedia({ video: { frameRate: targetFps }, audio: false });
    }
    case 'camera':
      return media.getUserMedia({
        video: config.deviceId ? { deviceId: { exact: config.deviceId } } : true,
      });
    case 'microphone':
      return media.getUserMedia({
        audio: config.deviceId ? { deviceId: { exact: config.deviceId } } : true,
      });
    case 'systemAudio': {
      await window.novarec.setCaptureSource({ sourceId: screenSourceId, audio: true });
      const combined = await media.getDisplayMedia({ video: true, audio: true });
      combined.getVideoTracks().forEach((t) => t.stop());
      return new MediaStream(combined.getAudioTracks());
    }
    default:
      throw new Error(`Unsupported track kind: ${String(config.kind)}`);
  }
}

export interface RecorderCallbacks {
  onSegmentCount(total: number): void;
  onError(message: string): void;
}

class TrackRecorder {
  private recorder: MediaRecorder | null = null;
  private lastChunkAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly recordingId: string,
    private readonly trackId: string,
    private readonly stream: MediaStream,
    private readonly isVideo: boolean,
    private readonly onError: (message: string) => void,
    private readonly onSegment: (count: number) => void,
  ) {}

  start(): void {
    const mime = pickMime(this.isVideo ? VIDEO_MIME : AUDIO_MIME);
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.recorder.ondataavailable = (event) => this.enqueue(event.data);
    this.recorder.onerror = () => this.onError(`Track ${this.trackId} reported an error`);
    this.lastChunkAt = performance.now();
    this.recorder.start(TIMESLICE_MS);
  }

  private enqueue(blob: Blob): void {
    if (blob.size === 0) return;
    const now = performance.now();
    const durationMs = Math.max(0, now - this.lastChunkAt);
    this.lastChunkAt = now;
    this.queue = this.queue.then(async () => {
      try {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { segmentCount } = await window.novarec.writeFragment({
          recordingId: this.recordingId,
          trackId: this.trackId,
          bytes,
          durationMs,
        });
        this.onSegment(segmentCount);
      } catch (error) {
        this.onError(error instanceof Error ? error.message : 'Failed to write a segment');
      }
    });
  }

  pause(): void {
    this.recorder?.pause();
  }

  resume(): void {
    this.lastChunkAt = performance.now();
    this.recorder?.resume();
  }

  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (recorder) {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      await this.queue;
    }
    this.stream.getTracks().forEach((t) => t.stop());
  }
}

export class MultiTrackRecorder {
  private recordingId: string | null = null;
  private tracks: TrackRecorder[] = [];
  private perTrack = new Map<string, number>();

  constructor(private readonly callbacks: RecorderCallbacks) {}

  async start(configs: TrackConfig[], targetFps: number): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    if (enabled.length === 0) throw new Error('Enable at least one track to record');

    const { recordingId } = await window.novarec.startRecording({ tracks: enabled });
    this.recordingId = recordingId;
    const screenSourceId = enabled.find((c) => c.kind === 'screen')?.sourceId ?? null;

    // Acquire each track independently — a failure (e.g. system-audio loopback
    // unavailable) skips that track instead of breaking the whole recording.
    for (const config of enabled) {
      try {
        const stream = await acquireStream(config, targetFps, screenSourceId);
        const isVideo = config.kind === 'screen' || config.kind === 'camera';
        const recorder = new TrackRecorder(
          recordingId,
          config.id,
          stream,
          isVideo,
          this.callbacks.onError,
          (count) => {
            this.perTrack.set(config.id, count);
            this.callbacks.onSegmentCount([...this.perTrack.values()].reduce((a, b) => a + b, 0));
          },
        );
        recorder.start();
        this.tracks.push(recorder);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.callbacks.onError(`Couldn't start ${config.label}: ${reason}`);
      }
    }

    if (this.tracks.length === 0) {
      await window.novarec.stopRecording({ recordingId, atMs: performance.now() });
      this.recordingId = null;
      throw new Error('No tracks could be started — check permissions and try again');
    }
  }

  async pause(): Promise<void> {
    this.tracks.forEach((t) => t.pause());
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
    this.tracks.forEach((t) => t.resume());
  }

  async stop(): Promise<{ dir: string } | null> {
    await Promise.all(this.tracks.map((t) => t.stop()));
    let result: { dir: string } | null = null;
    if (this.recordingId) {
      const summary = await window.novarec.stopRecording({
        recordingId: this.recordingId,
        atMs: performance.now(),
      });
      result = { dir: summary.dir };
    }
    this.tracks = [];
    this.recordingId = null;
    this.perTrack.clear();
    return result;
  }
}
