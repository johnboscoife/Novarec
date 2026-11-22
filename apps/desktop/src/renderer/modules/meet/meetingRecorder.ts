import { Track, type Room } from 'livekit-client';

/**
 * Composites every participant's video into a grid on a canvas and mixes all
 * their audio via Web Audio, exposing a single A/V MediaStream that the durable
 * recorder can capture. Participants joining/leaving mid-recording are picked up
 * each frame. The canvas needs no DOM; the hidden decode <video>s are attached
 * so they keep producing frames.
 */
const WIDTH = 1280;
const HEIGHT = 720;
const GAP = 8;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class MeetingRecorder {
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly audioCtx = new AudioContext();
  private readonly audioDest = this.audioCtx.createMediaStreamDestination();
  /** Hidden decode elements, with the track attached to each so it can be detached. */
  private readonly videos = new Map<string, { el: HTMLVideoElement; track: Track }>();
  /**
   * Mixed-in microphones, keyed by publication. The underlying MediaStreamTrack
   * is remembered too: LiveKit can swap it under the same publication (a mic
   * device switch), and the old one then goes silent for good.
   */
  private readonly audioSources = new Map<
    string,
    { node: MediaStreamAudioSourceNode; track: MediaStreamTrack }
  >();
  /** Every canvas capture handed out, stopped with the recorder. */
  private readonly captureTracks: MediaStreamTrack[] = [];
  // Identities kept OUT of the recording (composite + audio mix) — e.g. a
  // participant who joined mid-recording and hasn't consented yet.
  private readonly excluded = new Set<string>();
  private timer: number | null = null;

  constructor(private readonly room: Room) {
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
  }

  /** Keep a participant out of the recording until they consent. */
  exclude(identity: string): void {
    this.excluded.add(identity);
  }

  /** Admit a previously-excluded participant into the recording (they consented). */
  include(identity: string): void {
    this.excluded.delete(identity);
  }

  isExcluded(identity: string): boolean {
    return this.excluded.has(identity);
  }

  /** One A/V stream (composited video + mixed audio) for the recorder. */
  stream(fps = 30): MediaStream {
    const canvasTracks = this.canvas.captureStream(fps).getVideoTracks();
    this.captureTracks.push(...canvasTracks);
    return new MediaStream([...canvasTracks, ...this.audioDest.stream.getAudioTracks()]);
  }

  /**
   * Drawn on a timer, not requestAnimationFrame: rAF stops entirely while the
   * window is minimized or hidden, which froze the recorded meeting on one
   * frame. The window opts out of background throttling, so a timer keeps
   * ticking — the same reason the screen crop and compositor use timers.
   */
  start(fps = 30): void {
    if (this.audioCtx.state === 'suspended') void this.audioCtx.resume().catch(() => undefined);
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.draw(), 1000 / fps);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    for (const [, v] of this.videos) this.dropVideo(v);
    this.videos.clear();
    for (const [, s] of this.audioSources) s.node.disconnect();
    this.audioSources.clear();
    for (const track of this.captureTracks.splice(0)) track.stop();
    void this.audioCtx.close().catch(() => undefined);
  }

  private dropVideo(video: { el: HTMLVideoElement; track: Track }): void {
    video.track.detach(video.el);
    video.el.remove();
  }

  private draw(): void {
    // Excluded (non-consented) participants are neither composited nor mixed.
    const participants = this.participantList().filter((p) => !this.excluded.has(p.identity));
    this.sync(participants);

    this.ctx.fillStyle = '#0b0b0f';
    this.ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const rects = tileRects(participants.length);
    participants.forEach((p, i) => {
      const rect = rects[i];
      if (!rect) return;
      const cam = p.getTrackPublication(Track.Source.Camera);
      const video = cam?.trackSid ? this.videos.get(cam.trackSid)?.el : undefined;
      if (video && video.readyState >= 2 && cam && !cam.isMuted) {
        drawCover(this.ctx, video, rect);
      } else {
        this.ctx.fillStyle = '#16161d';
        this.ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        this.ctx.fillStyle = '#3b82f6';
        this.ctx.beginPath();
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const r = Math.min(rect.w, rect.h) * 0.18;
        this.ctx.arc(cx, cy, r, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.fillStyle = '#fff';
        this.ctx.font = `600 ${Math.round(r)}px system-ui, sans-serif`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText((p.name || p.identity || '?').slice(0, 1).toUpperCase(), cx, cy);
      }
      // Name label.
      this.ctx.fillStyle = 'rgba(0,0,0,0.55)';
      this.ctx.fillRect(rect.x + 8, rect.y + rect.h - 30, 220, 22);
      this.ctx.fillStyle = '#fff';
      this.ctx.font = '14px system-ui, sans-serif';
      this.ctx.textAlign = 'left';
      this.ctx.textBaseline = 'middle';
      const name =
        (p.name || p.identity || '') + (p === this.room.localParticipant ? ' (you)' : '');
      this.ctx.fillText(name.slice(0, 26), rect.x + 14, rect.y + rect.h - 19);
    });
  }

  private sync(participants: ReturnType<MeetingRecorder['participantList']>): void {
    const wantVideo = new Set<string>();
    const wantAudio = new Set<string>();

    for (const p of participants) {
      const cam = p.getTrackPublication(Track.Source.Camera);
      if (cam?.track && cam.trackSid) {
        wantVideo.add(cam.trackSid);
        if (!this.videos.has(cam.trackSid)) {
          const v = document.createElement('video');
          v.muted = true;
          v.playsInline = true;
          v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;';
          document.body.appendChild(v);
          cam.track.attach(v);
          void v.play().catch(() => undefined);
          this.videos.set(cam.trackSid, { el: v, track: cam.track });
        }
      }
      const mic = p.getTrackPublication(Track.Source.Microphone);
      const micTrack = mic?.track?.mediaStreamTrack;
      if (micTrack && mic?.trackSid) {
        wantAudio.add(mic.trackSid);
        const existing = this.audioSources.get(mic.trackSid);
        if (existing && existing.track !== micTrack) {
          // Same publication, new underlying track: reconnect to the live one.
          existing.node.disconnect();
          this.audioSources.delete(mic.trackSid);
        }
        if (!this.audioSources.has(mic.trackSid)) {
          try {
            const src = this.audioCtx.createMediaStreamSource(new MediaStream([micTrack]));
            src.connect(this.audioDest);
            this.audioSources.set(mic.trackSid, { node: src, track: micTrack });
          } catch {
            // track not ready — retry next frame
          }
        }
      }
    }

    for (const [sid, v] of this.videos) {
      if (!wantVideo.has(sid)) {
        this.dropVideo(v);
        this.videos.delete(sid);
      }
    }
    for (const [sid, s] of this.audioSources) {
      if (!wantAudio.has(sid)) {
        s.node.disconnect();
        this.audioSources.delete(sid);
      }
    }
  }

  private participantList() {
    return [this.room.localParticipant, ...this.room.remoteParticipants.values()];
  }
}

function tileRects(n: number): Rect[] {
  if (n <= 0) return [];
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const w = (WIDTH - GAP * (cols + 1)) / cols;
  const h = (HEIGHT - GAP * (rows + 1)) / rows;
  const rects: Rect[] = [];
  for (let i = 0; i < n; i += 1) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    rects.push({ x: GAP + c * (w + GAP), y: GAP + r * (h + GAP), w, h });
  }
  return rects;
}

function drawCover(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, r: Rect): void {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(r.w / vw, r.h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.drawImage(video, r.x + (r.w - dw) / 2, r.y + (r.h - dh) / 2, dw, dh);
  ctx.restore();
}
