import type { RecordingQuality, TrackConfig } from '@novarec/shared';
import { recommendedAudioBitrate, recommendedVideoBitrate } from '@novarec/capture';
import { CroppedScreenStream, type RegionSpec } from './cropStream.js';
import { CompositedVideoStream } from './compositeStream.js';
import { CursorEffectsStream, type CursorEffectsOptions } from './cursorEffects.js';

/**
 * Multi-track recording from the renderer. Each enabled track (screen, camera,
 * mic, system audio) gets its own MediaStream and MediaRecorder and streams
 * fragmented-MP4 chunks to main, which persists each as an independent, durable
 * track (they stay separate until export). Encoding runs in Chromium's media
 * pipeline, off the UI thread. See ADR-0005 (MediaRecorder) and ADR-0006
 * (per-track writers).
 */
// Profiles best-first. `avc1.42E01F` is Constrained BASELINE — no CABAC, no
// B-frames, no 8x8 transform — which every recording used to get. High profile
// is materially better at the same bitrate and is universally playable now.
const VIDEO_MIME = [
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=avc1.4D4028',
  'video/mp4;codecs=avc1.42E01F',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];
// A single stream carrying BOTH video and its own audio (e.g. a meeting's
// composited canvas + mixed mic audio). A video-only mime string silently drops
// the audio track, so the codec list must name an audio codec too.
const VIDEO_AUDIO_MIME = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4D4028,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01F,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];
const AUDIO_MIME = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
const TIMESLICE_MS = 1000;
// A capture is "stalled" if no chunk arrives for this long (well past the 1s
// timeslice, allowing for a badly loaded machine). Stop must never hang, so the
// wait for MediaRecorder.onstop and the final write flush are both time-capped.
const STALL_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 3000;
const QUEUE_FLUSH_TIMEOUT_MS = 6000;
// Backpressure: if unwritten fragments pile up in memory (the disk can't keep
// up with capture), we don't just warn — we pause the encoder until the write
// queue drains, so memory can't grow without bound and crash the recording.
// ~40 chunks ≈ 40s of buffered footage, or a hard 512 MB ceiling. Resume once
// the queue drains back below the low-water mark.
const MAX_PENDING_CHUNKS = 40;
const MAX_PENDING_BYTES = 512 * 1024 * 1024;
const RESUME_PENDING_CHUNKS = 20;

/** Track id used when the whole recording is written as one muxed file. */
export const SINGLE_TRACK_ID = 'recording';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  region: RegionSpec | null = null,
  hideCursor = false,
): Promise<MediaStream> {
  const media = navigator.mediaDevices;
  switch (config.kind) {
    case 'screen': {
      await window.novarec.setCaptureSource({ sourceId: config.sourceId ?? null, audio: false });
      // Cap capture to 1080p: encoding native 4K (e.g. a 3x-DPI display) at speed
      // is what stalls modest machines mid-recording. Chromium downscales for us.
      //
      // A region capture lifts that cap: what gets ENCODED is only the cropped
      // rect (itself capped at 1080p), so reading near-native pixels costs one
      // canvas draw and keeps a small region sharp instead of upscaling a
      // downscaled frame.
      const cap = region
        ? { width: { max: 3840 }, height: { max: 2160 } }
        : { width: { max: 1920 }, height: { max: 1080 } };
      return media.getDisplayMedia({
        // Leaving the pointer OUT of the capture is what makes smoothing
        // possible at all: one burned into the source pixels cannot be eased.
        video: { frameRate: targetFps, ...cap, ...(hideCursor ? { cursor: 'never' } : {}) },
        audio: false,
      });
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

/** Optional capture tweaks that apply to the whole take. */
export interface RecorderOptions {
  /** Record only this region of the captured display (null = the full display). */
  screenRegion?: RegionSpec | null;
  /**
   * Live cursor effects drawn into the capture: zoom toward the pointer, ring,
   * click ripples, smoothed pointer. Null leaves the screen untouched.
   */
  cursorEffects?: CursorEffectsOptions | null;
  /** How much bitrate the recording is given. */
  quality?: RecordingQuality;
  /**
   * Record ONE already-muxed file (video + mixed audio) instead of separate
   * per-source tracks. The result is a finished, playable recording the moment
   * it stops — no muxing pass afterwards. The cost is that the audio sources are
   * summed at capture time and can no longer be balanced separately later.
   */
  singleFile?: boolean;
}

export interface RecorderCallbacks {
  onSegmentCount(total: number): void;
  onError(message: string): void;
}

class TrackRecorder {
  private recorder: MediaRecorder | null = null;
  private lastChunkAt = 0;
  private queue: Promise<void> = Promise.resolve();
  private watchdog: number | null = null;
  private stalled = false;
  private pendingChunks = 0;
  private pendingBytes = 0;
  private backpressured = false;
  private throttled = false;
  private userPaused = false;

  constructor(
    private readonly recordingId: string,
    private readonly trackId: string,
    private readonly label: string,
    private readonly stream: MediaStream,
    private readonly onError: (message: string) => void,
    private readonly onSegment: (count: number) => void,
    /**
     * False when the stream came from the caller (a paired phone, a Studio
     * scene). Stopping one of those kills a source this recorder never opened —
     * the phone's preview dies and it has to be paired again.
     */
    private readonly ownsStream = true,
    private readonly quality: RecordingQuality = 'high',
    private readonly targetFps = 30,
    /**
     * The video comes from one of our own canvases, which is drawn on a steady
     * tick and therefore ALWAYS produces frames. Raw screen capture does not —
     * it is change-driven, so a still screen legitimately goes quiet.
     */
    private readonly steadySource = false,
  ) {}

  start(): void {
    // Choose the container/codec from what the stream actually carries, so a
    // combined video+audio stream never gets a video-only mime that drops audio.
    const hasVideo = this.stream.getVideoTracks().length > 0;
    const hasAudio = this.stream.getAudioTracks().length > 0;
    const candidates = hasVideo ? (hasAudio ? VIDEO_AUDIO_MIME : VIDEO_MIME) : AUDIO_MIME;
    const mime = pickMime(candidates);

    // Without an explicit bitrate MediaRecorder settles around 2.5 Mbps at ANY
    // resolution, which is what made 1080p screen text look soft. Size it from
    // what is actually being captured.
    const settings = this.stream.getVideoTracks()[0]?.getSettings();
    const width = settings?.width ?? 1920;
    const height = settings?.height ?? 1080;
    const fps = settings?.frameRate ?? this.targetFps;
    const options: MediaRecorderOptions = {
      ...(mime ? { mimeType: mime } : {}),
      ...(hasVideo
        ? { videoBitsPerSecond: recommendedVideoBitrate(width, height, fps, this.quality) }
        : {}),
      ...(hasAudio ? { audioBitsPerSecond: recommendedAudioBitrate(this.quality) } : {}),
    };
    this.recorder = new MediaRecorder(this.stream, options);
    this.recorder.ondataavailable = (event) => this.enqueue(event.data);
    this.recorder.onerror = () => this.onError(`${this.label} reported an error`);
    this.lastChunkAt = performance.now();
    this.recorder.start(TIMESLICE_MS);
    // Watchdog: report a capture that has genuinely died, so it can't masquerade
    // as a healthy recording.
    //
    // What counts as "died" differs by source. SCREEN capture is change-driven:
    // Chromium delivers a frame only when the picture changes, so a still screen
    // produces no data for as long as it stays still. Timing out on that reported
    // a stall every time the user simply stopped moving — the ended/live state of
    // the track is the only trustworthy signal there. AUDIO flows continuously
    // even in silence, so for an audio-only track a long gap really is a fault.
    this.watchdog = window.setInterval(() => {
      if (!this.recorder || this.recorder.state !== 'recording' || this.stalled) return;
      const tracks = this.stream.getTracks();
      if (tracks.length > 0 && tracks.every((t) => t.readyState === 'ended')) {
        this.stalled = true;
        this.onError(
          `${this.label} stopped — the capture source ended (screen sharing stopped, or the ` +
            'device was disconnected). You can stop; footage captured so far is saved.',
        );
        return;
      }
      // Meaningful again for a canvas source: silence there is a real fault,
      // not a still screen.
      if (
        (!hasVideo || this.steadySource) &&
        performance.now() - this.lastChunkAt > STALL_TIMEOUT_MS
      ) {
        this.stalled = true;
        this.onError(
          `${this.label} stopped producing data — the capture source may have stalled. ` +
            'You can stop; footage captured so far is saved.',
        );
      }
    }, 2000);
  }

  private enqueue(blob: Blob): void {
    if (blob.size === 0) return;
    const now = performance.now();
    const durationMs = Math.max(0, now - this.lastChunkAt);
    this.lastChunkAt = now;
    this.stalled = false;

    this.pendingChunks += 1;
    this.pendingBytes += blob.size;
    if (this.pendingChunks > MAX_PENDING_CHUNKS || this.pendingBytes > MAX_PENDING_BYTES) {
      if (!this.backpressured) {
        this.backpressured = true;
        this.onError(
          `${this.label}: the disk can't keep up with capture — pausing briefly to catch up. ` +
            'Lower the frame rate or free disk space to avoid gaps.',
        );
      }
      // Genuine backpressure: stop the encoder so memory can't grow unbounded.
      // ondataavailable won't fire while paused, so the queue drains.
      if (!this.throttled && !this.userPaused && this.recorder?.state === 'recording') {
        this.throttled = true;
        try {
          this.recorder.pause();
        } catch {
          // ignore — nothing we can do if the recorder refuses to pause
        }
      }
    }

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
      } finally {
        this.pendingChunks -= 1;
        this.pendingBytes -= blob.size;
        if (this.pendingChunks <= RESUME_PENDING_CHUNKS) {
          this.backpressured = false; // drained — allow a fresh warning if it recurs
          if (this.throttled && !this.userPaused && this.recorder?.state === 'paused') {
            this.throttled = false;
            // Resume from now so the drain gap isn't counted as recorded time.
            this.lastChunkAt = performance.now();
            try {
              this.recorder.resume();
            } catch {
              // ignore
            }
          }
        }
      }
    });
  }

  pause(): void {
    this.userPaused = true;
    this.throttled = false; // a user pause supersedes any backpressure pause
    this.recorder?.pause();
  }

  resume(): void {
    this.userPaused = false;
    this.throttled = false;
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
    if (this.watchdog !== null) {
      window.clearInterval(this.watchdog);
      this.watchdog = null;
    }
    const recorder = this.recorder;
    if (recorder) {
      // A stalled MediaRecorder may never fire onstop — never wait forever.
      await new Promise<void>((resolve) => {
        let settled = false;
        let timer = 0;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          resolve();
        };
        timer = window.setTimeout(finish, STOP_TIMEOUT_MS);
        recorder.onstop = finish;
        try {
          recorder.stop();
        } catch {
          finish();
        }
      });
      // Flush pending writes, but don't block stop if a write is wedged; the
      // sealed segments are already durable on disk.
      await Promise.race([this.queue, delay(QUEUE_FLUSH_TIMEOUT_MS)]);
    }
    if (this.ownsStream) this.stream.getTracks().forEach((t) => t.stop());
  }
}

/**
 * A microphone stream that survives its input device being unplugged mid-
 * recording. Audio is routed through a Web Audio destination whose output track
 * is STABLE, so the MediaRecorder never sees the track end (which would corrupt
 * the fMP4). When the live device ends, we re-acquire — falling back to the
 * system default — and reconnect to the same destination. There's a brief gap of
 * silence during the swap, but the track (and its single init segment) is intact.
 */
class ResilientAudioStream {
  private readonly ctx = new AudioContext();
  private readonly dest = this.ctx.createMediaStreamDestination();
  private source: MediaStreamAudioSourceNode | null = null;
  private live: MediaStream | null = null;
  private attaching: Promise<void> | null = null;
  private stopped = false;
  readonly stream = this.dest.stream;

  constructor(private readonly deviceId: string | null) {}

  async start(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    await this.requestAttach();
    navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChange);
  }

  /**
   * Single-flight re-acquire. Unplugging a mic fires BOTH `devicechange` and the
   * track's `ended` almost simultaneously; without de-duping, two overlapping
   * attaches each connect a new source to the destination — doubling/echoing the
   * audio and leaking a live stream. Coalesce them into one reconnect.
   */
  private requestAttach = (): Promise<void> => {
    if (!this.attaching) {
      this.attaching = this.attach().finally(() => {
        this.attaching = null;
      });
    }
    return this.attaching;
  };

  private attach = async (): Promise<void> => {
    const mic = await acquireDeviceStream('audio', this.deviceId);
    if (this.stopped) {
      mic.getTracks().forEach((t) => t.stop()); // stopped mid-acquire — don't leak
      return;
    }
    this.source?.disconnect();
    this.live?.getTracks().forEach((t) => t.stop());
    this.live = mic;
    this.source = this.ctx.createMediaStreamSource(mic);
    this.source.connect(this.dest);
    mic.getAudioTracks().forEach((track) => {
      track.onended = () => void this.requestAttach().catch(() => undefined);
    });
  };

  private onDeviceChange = (): void => {
    const track = this.live?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') void this.requestAttach().catch(() => undefined);
  };

  stop(): void {
    this.stopped = true;
    navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChange);
    this.source?.disconnect();
    this.live?.getTracks().forEach((t) => t.stop());
    void this.ctx.close().catch(() => undefined);
  }
}

/**
 * Sums several microphones/system-audio streams into ONE audio track for
 * single-file recording.
 *
 * The mic keeps its own gain node so muting still works on the mixed result —
 * the whole point of mixing is that there is no longer a separate mic track to
 * toggle.
 */
class AudioMixer {
  private readonly ctx = new AudioContext();
  private readonly dest = this.ctx.createMediaStreamDestination();
  private readonly sources: MediaStreamAudioSourceNode[] = [];
  private micGain: GainNode | null = null;
  private added = 0;

  add(stream: MediaStream, isMic: boolean): void {
    if (stream.getAudioTracks().length === 0) return;
    const source = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    source.connect(gain).connect(this.dest);
    this.sources.push(source);
    if (isMic) this.micGain = gain;
    this.added += 1;
  }

  async resume(): Promise<void> {
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
  }

  /** The mixed track, or null when nothing was added. */
  track(): MediaStreamTrack | null {
    return this.added > 0 ? (this.dest.stream.getAudioTracks()[0] ?? null) : null;
  }

  setMicMuted(muted: boolean): void {
    if (this.micGain) this.micGain.gain.value = muted ? 0 : 1;
  }

  stop(): void {
    this.sources.forEach((s) => s.disconnect());
    void this.ctx.close().catch(() => undefined);
  }
}

export class MultiTrackRecorder {
  private recordingId: string | null = null;
  private tracks: TrackRecorder[] = [];
  private micRecorder: TrackRecorder | null = null;
  private audioSwappers: ResilientAudioStream[] = [];
  private croppedScreens: CroppedScreenStream[] = [];
  private mixer: AudioMixer | null = null;
  private composited: CompositedVideoStream | null = null;
  private cursorEffects: CursorEffectsStream | null = null;
  /**
   * Streams this recorder OPENED and must therefore close. Anything handed in
   * by the caller is deliberately absent: releasing a device we did not acquire
   * is how a camera ends up dead after one take.
   */
  private ownedStreams: MediaStream[] = [];
  /** True when the recorded video comes from one of our canvases. */
  private steadyVideo = false;
  private quality: RecordingQuality = 'high';
  private fps = 30;
  // Recorded-elapsed clock. The manifest's segment offsets are cumulative
  // RECORDED time, so its pause/resume/stop timestamps must be on that same
  // scale — `performance.now()` is time since the page loaded, which in a
  // durable file that outlives the session means nothing at all.
  private startedAtMs = 0;
  private pausedAtMs = 0;
  private pausedAccumMs = 0;
  private perTrack = new Map<string, number>();

  constructor(private readonly callbacks: RecorderCallbacks) {}

  async start(
    configs: TrackConfig[],
    targetFps: number,
    providedStreams?: Record<string, MediaStream>,
    options?: RecorderOptions,
  ): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    if (enabled.length === 0) throw new Error('Enable at least one track to record');

    this.quality = options?.quality ?? 'high';
    this.fps = targetFps;
    this.steadyVideo = false;
    const singleFile = options?.singleFile === true;
    // In single-file mode main is told about ONE track, so it creates one
    // folder whose finalized file already IS the finished recording.
    const manifestTracks: TrackConfig[] = singleFile
      ? [
          {
            id: SINGLE_TRACK_ID,
            kind: 'screen',
            label: 'Recording',
            enabled: true,
            gain: 1,
            monitor: false,
          },
        ]
      : enabled;
    const { recordingId } = await window.novarec.startRecording({ tracks: manifestTracks });
    this.recordingId = recordingId;
    this.startedAtMs = performance.now();
    this.pausedAccumMs = 0;
    const screenSourceId = enabled.find((c) => c.kind === 'screen')?.sourceId ?? null;

    // Acquire each track independently — a failure (e.g. system-audio loopback
    // unavailable) skips that track instead of breaking the whole recording.
    // A caller (Studio) can inject an already-acquired stream by track id.
    const acquired: { config: TrackConfig; stream: MediaStream; owned: boolean }[] = [];
    for (const config of enabled) {
      try {
        let stream: MediaStream;
        if (config.kind === 'microphone' && !providedStreams?.[config.id]) {
          // Record the mic through a resilient pipeline so unplugging the device
          // mid-recording swaps to the system default instead of dropping audio.
          const swapper = new ResilientAudioStream(config.deviceId ?? null);
          try {
            await swapper.start();
          } catch (error) {
            // Its AudioContext exists from construction; a start that fails
            // (permission denied, no device) must still close it — Chromium
            // caps live AudioContexts — and must not linger to reopen the mic.
            swapper.stop();
            throw error;
          }
          this.audioSwappers.push(swapper);
          stream = swapper.stream;
        } else if (
          config.kind === 'screen' &&
          options?.screenRegion &&
          !providedStreams?.[config.id]
        ) {
          // Region capture: record only the picked rect. `getDisplayMedia` can
          // only hand back a whole display, so the crop is applied to the frames
          // before they reach the encoder.
          const raw = await acquireStream(
            config,
            targetFps,
            screenSourceId,
            options.screenRegion,
            options.cursorEffects?.drawCursor ?? false,
          );
          const cropped = await CroppedScreenStream.create(raw, options.screenRegion, targetFps);
          if (cropped) {
            this.croppedScreens.push(cropped);
            stream = cropped.stream;
            this.steadyVideo = true;
          } else {
            stream = raw; // region covers the whole display — nothing to crop
          }
        } else {
          stream =
            providedStreams?.[config.id] ??
            (await acquireStream(
              config,
              targetFps,
              screenSourceId,
              null,
              config.kind === 'screen' ? (options?.cursorEffects?.drawCursor ?? false) : false,
            ));
        }
        // Cursor effects are drawn onto the SCREEN only, after any region crop
        // — the crop changes what the frame contains, and the pointer has to be
        // mapped into whatever the frame ended up being.
        if (config.kind === 'screen' && options?.cursorEffects) {
          try {
            const effects = await CursorEffectsStream.create(stream, {
              ...options.cursorEffects,
              onEffectsFailed: () => {
                this.callbacks.onError(
                  'Cursor effects stopped responding — the recording continues without them.',
                );
              },
            });
            this.cursorEffects = effects;
            this.ownedStreams.push(stream);
            stream = effects.stream;
            this.steadyVideo = true;
          } catch (error) {
            const reason = error instanceof Error ? error.message : 'unknown error';
            this.callbacks.onError(
              `Cursor effects are unavailable (${reason}) — recording without them.`,
            );
          }
        }
        // A stream the caller handed us stays theirs to close.
        const owned = providedStreams?.[config.id] !== stream;
        if (owned) this.ownedStreams.push(stream);
        acquired.push({ config, stream, owned });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.callbacks.onError(`Couldn't start ${config.label}: ${reason}`);
      }
    }

    if (singleFile) {
      await this.startSingleFile(recordingId, acquired, targetFps);
    } else {
      for (const { config, stream } of acquired) {
        // Ownership is handled centrally, so the per-track recorder never
        // closes a device — it would double-stop, or kill a borrowed one.
        const recorder = this.createTrackRecorder(
          recordingId,
          config.id,
          config.label,
          stream,
          false,
          config.kind === 'screen' && this.steadyVideo,
        );
        recorder.start();
        this.tracks.push(recorder);
        if (config.kind === 'microphone') this.micRecorder = recorder;
      }
    }

    if (this.tracks.length === 0) {
      this.audioSwappers.forEach((s) => s.stop());
      this.audioSwappers = [];
      this.croppedScreens.forEach((c) => c.stop());
      this.croppedScreens = [];
      this.mixer?.stop();
      this.mixer = null;
      this.composited?.stop();
      this.composited = null;
      this.cursorEffects?.stop();
      this.cursorEffects = null;
      this.releaseOwnedStreams();
      await window.novarec.stopRecording({ recordingId, atMs: this.elapsedMs() });
      this.recordingId = null;
      throw new Error('No tracks could be started — check permissions and try again');
    }
  }

  private createTrackRecorder(
    recordingId: string,
    trackId: string,
    label: string,
    stream: MediaStream,
    ownsStream = true,
    steadySource = false,
  ): TrackRecorder {
    return new TrackRecorder(
      recordingId,
      trackId,
      label,
      stream,
      this.callbacks.onError,
      (count) => {
        this.perTrack.set(trackId, count);
        this.callbacks.onSegmentCount([...this.perTrack.values()].reduce((a, b) => a + b, 0));
      },
      ownsStream,
      this.quality,
      this.fps,
      steadySource,
    );
  }

  /** Release every device this recorder opened. */
  private releaseOwnedStreams(): void {
    this.ownedStreams.forEach((stream) => stream.getTracks().forEach((t) => t.stop()));
    this.ownedStreams = [];
  }

  /**
   * Combine everything acquired into one video+audio stream and record that.
   * MediaRecorder then writes a single file carrying both, so what lands on
   * disk is already the finished recording.
   */
  private async startSingleFile(
    recordingId: string,
    acquired: { config: TrackConfig; stream: MediaStream }[],
    targetFps: number,
  ): Promise<void> {
    const withVideo = acquired.filter((a) => a.stream.getVideoTracks().length > 0);
    let video: MediaStreamTrack[] = [];
    if (withVideo.length === 1) {
      video = withVideo[0]!.stream.getVideoTracks().slice(0, 1);
    } else if (withVideo.length > 1) {
      // One file carries one video track, so a screen AND a camera have to be
      // composited — taking the first and discarding the rest would record a
      // camera that isn't in the file.
      const base = withVideo.find((a) => a.config.kind === 'screen') ?? withVideo[0]!;
      const overlay = withVideo.find((a) => a !== base)!;
      try {
        const composited = await CompositedVideoStream.create(
          base.stream,
          overlay.stream,
          targetFps,
        );
        this.composited = composited;
        video = composited.stream.getVideoTracks();
        this.steadyVideo = true;
      } catch (error) {
        // Compositing failed: record the screen rather than nothing, and say so
        // instead of quietly producing a take without the camera in it. The
        // source streams are untouched by a failed compositor, so the screen
        // track here is still live.
        const reason = error instanceof Error ? error.message : 'unknown error';
        this.callbacks.onError(
          `Couldn't overlay the camera (${reason}) — recording the screen only.`,
        );
        video = base.stream
          .getVideoTracks()
          .filter((t) => t.readyState === 'live')
          .slice(0, 1);
      }
    }

    const mixer = new AudioMixer();
    this.mixer = mixer;
    for (const { config, stream } of acquired) {
      mixer.add(stream, config.kind === 'microphone');
    }
    void mixer.resume();

    const audio = mixer.track();
    const merged = new MediaStream([...video, ...(audio ? [audio] : [])]);
    if (merged.getTracks().length === 0) return; // nothing acquired; caller reports it

    const recorder = this.createTrackRecorder(
      recordingId,
      SINGLE_TRACK_ID,
      'Recording',
      merged,
      false,
    );
    recorder.start();
    this.tracks.push(recorder);
  }

  /** A still of the frame being recorded, or null when there is nothing to grab. */
  snapshot(): Promise<Blob | null> {
    return this.cursorEffects?.snapshot() ?? Promise.resolve(null);
  }

  /** Zoom the capture toward the pointer, or back out. No-op without effects. */
  setZoomed(zoomed: boolean): void {
    this.cursorEffects?.setZoomed(zoomed);
  }

  /** Whether the capture is currently zoomed in. */
  get zoomed(): boolean {
    return this.cursorEffects?.zoomed ?? false;
  }

  /** The live recording's id, or null when nothing is being recorded. */
  get id(): string | null {
    return this.recordingId;
  }

  /** Mute or unmute the microphone track mid-recording (no-op if none). */
  setMicMuted(muted: boolean): void {
    // Single-file mode has no separate mic track to toggle — the mic is summed
    // into the one audio track, so muting happens at its gain node instead.
    if (this.mixer) this.mixer.setMicMuted(muted);
    else this.micRecorder?.setStreamEnabled(!muted);
  }

  /** Milliseconds of actual recorded footage so far (pauses excluded). */
  /**
   * Recorded time so far. A pause in progress is not yet in `pausedAccumMs`
   * (that happens on resume), so it is subtracted here — otherwise a marker
   * dropped, or a stop pressed, while paused lands later than the footage.
   */
  elapsedMs(): number {
    if (this.startedAtMs === 0) return 0;
    const now = performance.now();
    const currentPause = this.pausedAtMs > 0 ? now - this.pausedAtMs : 0;
    return Math.max(0, now - this.startedAtMs - this.pausedAccumMs - currentPause);
  }

  async pause(): Promise<void> {
    this.tracks.forEach((t) => t.pause());
    const atMs = this.elapsedMs();
    this.pausedAtMs = performance.now();
    if (this.recordingId) {
      await window.novarec.pauseRecording({ recordingId: this.recordingId, atMs });
    }
  }

  async resume(): Promise<void> {
    if (this.pausedAtMs > 0) {
      this.pausedAccumMs += performance.now() - this.pausedAtMs;
      this.pausedAtMs = 0;
    }
    if (this.recordingId) {
      await window.novarec.resumeRecording({
        recordingId: this.recordingId,
        atMs: this.elapsedMs(),
      });
    }
    this.tracks.forEach((t) => t.resume());
  }

  async stop(): Promise<{ dir: string } | null> {
    try {
      await Promise.all(this.tracks.map((t) => t.stop()));
      if (!this.recordingId) return null;
      const summary = await window.novarec.stopRecording({
        recordingId: this.recordingId,
        atMs: this.elapsedMs(),
      });
      return { dir: summary.dir };
    } finally {
      // Always release, even when finalizing failed: the caller has already
      // let go of this recorder, so anything left running here (the capture,
      // the camera) could never be stopped again.
      this.release();
    }
  }

  private release(): void {
    this.audioSwappers.forEach((s) => s.stop());
    this.audioSwappers = [];
    // Tear down the crop pump and its underlying full-screen capture.
    this.croppedScreens.forEach((c) => c.stop());
    this.croppedScreens = [];
    this.mixer?.stop();
    this.mixer = null;
    this.composited?.stop();
    this.composited = null;
    this.cursorEffects?.stop();
    this.cursorEffects = null;
    // Every device this recorder opened is closed here, so nothing is left
    // held after a take — a camera stuck 'in use' is the classic symptom.
    this.releaseOwnedStreams();
    this.tracks = [];
    this.micRecorder = null;
    this.recordingId = null;
    this.startedAtMs = 0;
    this.pausedAtMs = 0;
    this.pausedAccumMs = 0;
    this.perTrack.clear();
  }
}
