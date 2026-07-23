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
/**
 * Acquire a camera/mic stream by device id, falling back to the system default
 * if that exact device is gone (e.g. an external mic was unplugged) — so a
 * disconnected device doesn't silently drop the track.
 */
export async function acquireDeviceStream(
  kind: 'audio' | 'video',
  deviceId: string | null,
): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  const constraint = (id: string | null): MediaStreamConstraints =>
    kind === 'audio'
      ? { audio: id ? { deviceId: { exact: id } } : true }
      : { video: id ? { deviceId: { exact: id } } : true };
  try {
    return await media.getUserMedia(constraint(deviceId));
  } catch (error) {
    if (!deviceId) throw error; // already asked for the default — nothing to fall back to
    return media.getUserMedia(constraint(null)); // chosen device unavailable → system default
  }
}

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
      return acquireDeviceStream('video', config.deviceId ?? null);
    case 'microphone':
      return acquireDeviceStream('audio', config.deviceId ?? null);
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

  /** Mute/unmute by toggling the stream's audio tracks (keeps timing intact). */
  setStreamEnabled(enabled: boolean): void {
    this.stream.getAudioTracks().forEach((track) => {
      track.enabled = enabled;
    });
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
  private micRecorder: TrackRecorder | null = null;
  private perTrack = new Map<string, number>();

  constructor(private readonly callbacks: RecorderCallbacks) {}

  async start(
    configs: TrackConfig[],
    targetFps: number,
    providedStreams?: Record<string, MediaStream>,
  ): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    if (enabled.length === 0) throw new Error('Enable at least one track to record');

    const { recordingId } = await window.novarec.startRecording({ tracks: enabled });
    this.recordingId = recordingId;
    const screenSourceId = enabled.find((c) => c.kind === 'screen')?.sourceId ?? null;

    // Acquire each track independently — a failure (e.g. system-audio loopback
    // unavailable) skips that track instead of breaking the whole recording.
    // A caller (Studio) can inject an already-acquired stream by track id.
    for (const config of enabled) {
      try {
        const stream =
          providedStreams?.[config.id] ?? (await acquireStream(config, targetFps, screenSourceId));
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
        if (config.kind === 'microphone') this.micRecorder = recorder;
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

  /** Mute or unmute the microphone track mid-recording (no-op if none). */
  setMicMuted(muted: boolean): void {
    this.micRecorder?.setStreamEnabled(!muted);
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
    this.micRecorder = null;
    this.recordingId = null;
    this.perTrack.clear();
    return result;
  }
}
