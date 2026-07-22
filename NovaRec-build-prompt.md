# NovaRec — Master Build Prompt

> **How to use this:** Open an empty folder in VS Code, start your AI coding agent (GitHub Copilot Agent Mode, Claude Code, Cline, or Cursor), and paste everything below the line. Save this file in the repo as `PROMPT.md` so the agent can re-read it whenever it loses context.

---

# ROLE

You are the lead engineer building **NovaRec** from an empty repository. You will work in phases. Do not skip ahead. At the end of every phase, stop, run the acceptance checks, and report status before starting the next phase.

# PRODUCT

**NovaRec** is a cross-platform desktop application that unifies three things people currently need three separate apps for:

1. **Record** — a professional screen recorder (what Clipchamp should have been)
2. **Meet** — multi-party video meetings with recording and transcripts (Google Meet class)
3. **Studio** — a scene-based live compositor and streaming engine (OBS class)

All three share one capture engine, one compositor, and one media pipeline. That shared core is the entire reason this product exists — do not build three disconnected apps inside one window.

**Positioning:** OBS is powerful but intimidating. Clipchamp is friendly but crippled. NovaRec is OBS's engine behind Clipchamp's front door.

---

# NON-NEGOTIABLE ENGINEERING RULES

Read these before writing any code. Most of them exist because they are the exact failures of the incumbents.

1. **Never lose a recording.** Capture writes fragmented MP4 segments to disk continuously via an append-only manifest. Pause/resume appends a new segment — it never rewrites, truncates, or replaces a previous one. If the app crashes mid-recording, the next launch must detect orphaned segments and offer recovery. Write the crash-recovery test before you write the happy path.
2. **Tracks stay separate until export.** Screen, camera, microphone, system audio, and annotation overlay are recorded as independent, time-aligned tracks. Never flatten at capture time. Every downstream feature (reposition the webcam, duck system audio, delete the camera from a finished take) depends on this.
3. **The capture thread never touches the UI thread.** Encoding runs in the main process or a worker. Dropping a frame because React re-rendered is a defect.
4. **Everything works offline.** Local recording, local editing, and local export must function with zero network. Cloud features are additive and always optional.
5. **Explicit consent for every stream.** Recording indicators are always visible and cannot be hidden by configuration. Participants in a meeting are notified before recording starts. No silent capture, ever.
6. **Type safety end to end.** TypeScript strict mode. No `any`. All IPC messages validated with Zod at both ends.
7. **Performance budgets are acceptance criteria, not aspirations.** See the budgets section.

---

# TECH STACK

Use exactly this unless you hit a hard blocker, in which case stop and explain the blocker before substituting.

**Desktop shell**
- Electron (latest stable) + electron-vite + electron-builder
- React 19 + TypeScript (strict) + Vite
- Tailwind CSS + Radix UI primitives
- Zustand for state, TanStack Query for server state
- Zod for all schema validation

**Media**
- `desktopCapturer` + platform capture: Windows.Graphics.Capture (Windows), ScreenCaptureKit (macOS 13+), PipeWire/xdg-desktop-portal (Linux)
- WebCodecs (`VideoEncoder` / `VideoDecoder`) for hardware-accelerated encode where available
- FFmpeg (bundled static binaries) for muxing, remuxing, export, and RTMP/SRT egress
- WebGL2 compositor with `OffscreenCanvas` in a dedicated worker
- `mp4box.js` for fragmented MP4 manifest handling

**Meetings**
- LiveKit (self-hostable, Apache 2.0) as the SFU
- Node + Fastify signaling/token service
- JWT room tokens, short TTL

**Streaming out**
- FFmpeg RTMP/RTMPS/SRT
- Virtual camera: DirectShow/Media Foundation filter (Windows), CoreMediaIO DAL plugin (macOS), v4l2loopback (Linux)

**Intelligence (all local by default)**
- whisper.cpp bindings for transcription and captions
- Silero VAD for silence and filler-word detection

**Storage**
- SQLite via better-sqlite3 for projects, scenes, markers, transcripts
- Media files on disk in a content-addressed vault, never in the database

**Quality**
- Vitest (unit), Playwright (E2E on the renderer), ESLint + Prettier, Husky pre-commit
- Conventional Commits, GitHub Actions CI building all three platforms

---

# REPOSITORY STRUCTURE

Create this as a pnpm workspace monorepo:

```
novarec/
├── apps/
│   ├── desktop/                 # Electron app
│   │   ├── src/main/            # main process: capture, encode, IPC, windows
│   │   ├── src/preload/         # contextBridge API surface only
│   │   └── src/renderer/        # React UI
│   │       ├── modules/record/
│   │       ├── modules/meet/
│   │       ├── modules/studio/
│   │       ├── modules/editor/
│   │       └── modules/shell/   # nav, settings, onboarding
│   └── server/                  # Fastify: LiveKit tokens, rooms, optional share links
├── packages/
│   ├── capture/                 # source enumeration, region capture, track manager
│   ├── compositor/              # WebGL2 scene graph, transitions, effects
│   ├── encoder/                 # WebCodecs + FFmpeg abstraction, segment writer
│   ├── timeline/                # editing model, ripple ops, transcript sync
│   ├── overlay/                 # annotation, redaction, cursor-zoom engine
│   ├── ui/                      # shared design system
│   └── shared/                  # Zod schemas, types, IPC contract, constants
├── e2e/
└── docs/
    ├── ARCHITECTURE.md
    ├── IPC.md
    └── DECISIONS/               # one ADR per significant choice
```

---

# CORE DATA MODEL

Define these in `packages/shared` first. Everything else builds on them.

```ts
type SourceKind = 'display' | 'window' | 'region' | 'camera' | 'microphone'
                | 'systemAudio' | 'image' | 'video' | 'browser' | 'text' | 'capture-card';

interface CaptureSource {
  id: string;
  kind: SourceKind;
  label: string;
  deviceId?: string;
  bounds?: { x: number; y: number; width: number; height: number }; // region capture
  targetFps: number;
  audioLoopback?: boolean;
}

interface Track {
  id: string;
  recordingId: string;
  kind: 'video' | 'audio' | 'overlay' | 'cursor' | 'events';
  sourceId: string;
  segments: Segment[];         // append-only, never mutated
  offsetMs: number;            // alignment against session clock
}

interface Segment {
  id: string;
  path: string;
  startMs: number;
  durationMs: number;
  sealed: boolean;             // fsync'd and finalized
}

interface Recording {
  id: string;
  createdAt: string;
  status: 'recording' | 'paused' | 'finalizing' | 'ready' | 'recovered';
  tracks: Track[];
  markers: Marker[];
  cursorEvents: CursorEvent[]; // drives post-hoc zoom
  redactionZones: RedactionZone[];
  transcript?: Transcript;
}

interface Marker { id: string; atMs: number; label: string; color: string; }
interface CursorEvent { atMs: number; x: number; y: number; event: 'move' | 'click' | 'drag' | 'keypress'; }
interface RedactionZone { id: string; rect: Rect; mode: 'blur' | 'pixelate' | 'solid'; fromMs: number; toMs: number | null; follow?: 'window' | 'fixed'; }

interface Scene { id: string; name: string; layers: Layer[]; transitionIn: Transition; }
interface Layer { id: string; sourceId: string; transform: Transform; filters: Filter[]; opacity: number; locked: boolean; visible: boolean; }
```

---

# PHASE PLAN

## Phase 0 — Foundation
- Scaffold the monorepo, workspaces, TypeScript strict configs, linting, Husky, CI.
- Boot an Electron window rendering a placeholder React shell with three nav destinations: Record, Meet, Studio.
- Write `docs/ARCHITECTURE.md` describing the shared-core principle.
- **Acceptance:** `pnpm dev` opens the app on your OS; `pnpm build` produces an installer; CI green.

## Phase 1 — Capture engine
- Enumerate displays, windows, cameras, microphones, and system audio devices.
- Implement **custom region capture**: a draggable, resizable, snap-to-window selection overlay on a transparent always-on-top window. Region persists between sessions.
- Multi-monitor aware. Handle DPI scaling correctly — test on a mixed-DPI setup.
- Selectable target FPS (24 / 30 / 60 / 120) and resolution, with a live "your machine can sustain X" indicator based on a 3-second probe.
- **Acceptance:** capture a region across two monitors at 60fps for 5 minutes with no dropped-frame warnings.

## Phase 2 — Segmented recorder and crash recovery
- Implement the segment writer: fragmented MP4 chunks of ~2s, fsync'd, listed in an append-only JSON manifest alongside the media.
- Pause appends a segment boundary. Resume opens a new segment. **Prove with a test that N pause cycles yield N+1 segments and that concatenated duration equals wall-clock recording time.**
- Kill the process mid-recording in a test; on relaunch, detect the orphaned manifest and reconstruct a playable file.
- **Acceptance:** automated test suite covering pause/resume integrity, hard-kill recovery, and disk-full graceful stop.

## Phase 3 — Multi-track capture
- Record screen, camera, mic, and system audio as separate synchronized tracks against a single monotonic session clock.
- Track-level controls before recording: enable/disable, device, gain, monitoring.
- Camera is captured raw, not composited — position and shape are decided later.
- On Windows use loopback audio capture; on macOS use ScreenCaptureKit audio (13+) with a documented fallback; on Linux use PipeWire.
- **Acceptance:** a 10-minute take produces 4 files whose A/V sync drift is under 40ms end to end.

## Phase 4 — The overlay engine (the differentiator)
Build these as a single input-driven overlay system, not four separate features:

- **Cursor zoom:** record cursor position and click events as a data track. Post-recording, generate smooth zoom-and-pan keyframes with configurable intensity, easing, and hold duration. Every keyframe is editable and deletable. Also offer a live-preview mode for streaming.
- **Click emphasis:** configurable ring, ripple, spotlight, and optional click sound.
- **Live annotation:** pen, arrow, rectangle, ellipse, highlighter, text, laser pointer (auto-fading trail). Drawn to the overlay track, so annotations are erasable after the fact.
- **Live redaction:** blur/pixelate/solid regions applied at capture so sensitive pixels are never written to disk. Support fixed rectangles and window-following redaction. Add a preset that auto-detects and blurs common credential UI on request.
- **Markers:** global hotkey drops a labeled marker; markers appear on the editor timeline and become chapter points on export.
- **Teleprompter:** scrolling script overlay, adjustable speed and opacity, positioned near the camera, excluded from output.
- **Acceptance:** record a 3-minute demo using all six simultaneously with no frame drops on mid-tier hardware.

## Phase 5 — Global hotkeys and countdown
- System-wide, remappable shortcuts registered even when NovaRec is unfocused: start/stop, pause/resume, marker, annotate toggle, cursor-zoom-now, mute mic, panic-stop.
- Configurable countdown before recording begins; auto-hide the NovaRec window during capture.
- Conflict detection against OS-reserved shortcuts.
- **Acceptance:** full recording lifecycle driven entirely from another application without ever focusing NovaRec.

## Phase 6 — Editor
- Multi-track timeline: trim, split, ripple delete, speed ramp, volume envelopes, per-track mute/solo.
- **Camera track is fully repositionable after the fact** — shape (circle/square/rounded), size, corner, border, shadow, and background removal.
- **Transcript-based editing:** local Whisper transcription; deleting a word or sentence in the transcript cuts the corresponding video. Filler-word detection with one-click removal of all instances.
- Silence removal with an adjustable threshold and preview-before-apply.
- Auto-chapters from markers. Captions with styling. Brand kit (logo, colors, fonts, lower-thirds).
- **Acceptance:** edit a 20-minute recording down to 8 minutes using only the transcript panel, then export with burned captions and chapter metadata.

## Phase 7 — Export
- Presets: YouTube, LinkedIn, TikTok/Reels/Shorts, GIF, audio-only, lossless master.
- Full control over container, codec (H.264/HEVC/AV1), resolution up to 4K, frame rate up to 120, bitrate mode (CBR/VBR/CRF).
- Hardware encode with an automatic software fallback; queue with progress, pause, and cancel.
- Optional: local `.novarec` project bundle export for handoff.
- **Acceptance:** 4K60 export of a 10-minute multi-track project completes without frame loss and passes an ffprobe integrity check.

## Phase 8 — Meet
- LiveKit-backed rooms: create, join by link, lobby/waiting room, host controls.
- Grid, speaker, and presentation layouts. Screen share reuses the Phase 1 capture engine — so a meeting share supports region capture, annotation, and cursor zoom, which is something no mainstream meeting app offers.
- Chat, reactions, raise hand, per-participant mute, participant list.
- **Meeting recording uses the Phase 2/3 pipeline:** every participant recorded to a separate track, plus a composited program track. Local-first, cloud optional.
- Live captions and post-meeting transcript with speaker labels and an action-item summary.
- Explicit, unmissable recording consent banner for all participants.
- **Acceptance:** a 5-participant, 30-minute meeting produces per-participant tracks with sync drift under 100ms and a speaker-labeled transcript.

## Phase 9 — Studio
- Scene collection with unlimited scenes; each scene holds ordered layers.
- Source types: display, window, region, camera, capture card, image, video, browser source (with custom CSS), text, audio input.
- Full transform per layer: position, scale, rotate, crop, opacity, blend mode; alignment guides and snapping.
- Filters: chroma key, color correction, LUT, blur, mask, noise suppression, noise gate, compressor.
- Transitions: cut, fade, slide, stinger.
- Audio mixer with per-source faders, VU meters, monitoring routing, and sync offset.
- **Virtual camera output** so NovaRec scenes can be selected as a webcam in Zoom, Teams, Meet, or anything else.
- Streaming out to RTMP/RTMPS/SRT with presets for YouTube, Twitch, LinkedIn, Facebook, and custom endpoints; multi-destination simulcast; live health telemetry (bitrate, dropped frames, encoder load) with automatic bitrate adaptation.
- Record and stream simultaneously at independent quality settings.
- Hotkey-driven scene switching; optional Stream Deck compatibility.
- **Acceptance:** stream 1080p60 to two destinations for 30 minutes while recording a 4K master locally, with dropped frames under 0.1%.

## Phase 10 — Polish and ship
- Onboarding that gets a first recording done in under 60 seconds.
- Settings: capture defaults, hotkeys, storage location and quota, appearance, privacy.
- Auto-update via electron-updater; signed and notarized builds for Windows and macOS; AppImage/deb for Linux.
- Telemetry strictly opt-in, anonymous, and fully documented in-app.
- Accessibility: full keyboard navigation, screen-reader labels, WCAG AA contrast, reduced-motion support.
- **Acceptance:** clean install on all three platforms passes a scripted smoke test of the full record → edit → export flow.

---

# PERFORMANCE BUDGETS (treated as tests)

| Metric | Target |
|---|---|
| Cold start to interactive | < 2.5s |
| Idle CPU | < 3% |
| Recording 1080p60 CPU | < 15% with hardware encode |
| Dropped frames during a 30-min capture | < 0.1% |
| A/V sync drift over 30 min | < 50ms |
| Editor timeline scrub response | < 16ms per frame |
| Installed size | < 250MB |

---

# SECURITY AND PRIVACY REQUIREMENTS

- Recording indicator is always visible and cannot be disabled.
- Redacted pixels are never written to disk in any form.
- All local media encrypted at rest when the user enables vault mode.
- Meeting recording requires affirmative consent from participants; consent state is logged.
- No transcription, no media, and no telemetry leaves the device unless the user explicitly enables a cloud feature.
- Context isolation on, node integration off, a strict CSP, and a minimal preload surface. Validate every IPC payload with Zod on the main-process side.

---

# WORKING AGREEMENT

- Work one phase at a time. Show me the plan for a phase before implementing it.
- Write the test for any correctness-critical behavior (segment integrity, sync, recovery) before the implementation.
- Any deviation from this spec gets an ADR in `docs/DECISIONS/` explaining the trade-off.
- Prefer boring, well-supported libraries over clever ones. This app handles people's unrecoverable work.
- Commit in small, conventional commits. Keep `main` always runnable.
- If a native capability is unavailable on a platform, implement a documented fallback and surface the limitation in the UI rather than failing silently.

**Start with Phase 0. Show me the repo structure and the `package.json` files before creating anything else.**
