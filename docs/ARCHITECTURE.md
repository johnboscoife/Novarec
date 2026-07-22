# NovaRec Architecture

NovaRec unifies three products that people currently reach for three separate
apps to do:

- **Record** — a professional screen recorder (what Clipchamp should have been).
- **Meet** — multi-party video meetings with recording and transcripts.
- **Studio** — a scene-based live compositor and streaming engine (OBS class).

## The shared-core principle (the entire reason this product exists)

Record, Meet, and Studio are **not** three apps sharing a window. They are three
front doors onto **one** engine:

```
                 ┌─────────────┐  ┌───────────┐  ┌────────────┐
   front doors   │   Record    │  │   Meet    │  │   Studio   │
                 └──────┬──────┘  └─────┬─────┘  └──────┬─────┘
                        └───────────────┼───────────────┘
                                        │
             ┌──────────────────────────┴──────────────────────────┐
 shared core │  capture · compositor · encoder · overlay · timeline │
             └──────────────────────────┬──────────────────────────┘
                                        │
                              ┌─────────┴─────────┐
                     data     │ shared: schemas,  │
                              │ IPC contract,     │
                              │ constants (Zod)   │
                              └───────────────────┘
```

A capability built once is available everywhere. Because Studio's screen share
reuses the same `capture` engine as Record, a **meeting** screen-share supports
region capture, live annotation, and cursor zoom — something no mainstream
meeting app offers. That leverage only exists if the core stays shared, so:

> **Do not build three disconnected apps inside one window.** Any feature that
> touches capture, compositing, encoding, overlay, or the timeline belongs in a
> `packages/*` core package, consumed by all three front doors.

## Process model (Electron)

| Process      | Responsibility                                                           | Notes                                                                                 |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **main**     | Capture, encode, window management, IPC, filesystem, native capture APIs | Full Node. Never blocked by UI work.                                                  |
| **preload**  | The single `contextBridge` surface (`window.novarec`)                    | Minimal, explicit, no business logic. `sandbox: true`.                                |
| **renderer** | React UI for all three front doors                                       | `contextIsolation: true`, `nodeIntegration: false`. No direct Node/filesystem access. |
| **workers**  | Compositor (OffscreenCanvas + WebGL2), heavy DSP                         | Keep the capture/encode path off the UI thread.                                       |

**The capture thread never touches the UI thread.** Encoding runs in the main
process or a dedicated worker. Dropping a frame because React re-rendered is a
defect, not a tradeoff (see Performance Budgets in the build spec).

## Data model

The core vocabulary lives in [`packages/shared`](../packages/shared) as **Zod
schemas with inferred TypeScript types** — everything else builds on it:

- `CaptureSource` — anything we can capture or place on a scene.
- `Track` / `Segment` — independent, time-aligned streams; segments are
  **append-only** (see below).
- `Recording` — the top-level unit; tracks stay separate until export.
- `Scene` / `Layer` — the Studio/compositor model.
- Overlay data: `CursorEvent`, `Marker`, `RedactionZone`, `Transcript`.

### Two invariants encoded in the model

1. **Never lose a recording.** `Segment`s are append-only and `sealed` (fsync'd)
   once written — never rewritten, truncated, or replaced. Pause/resume appends
   a new segment. A crash leaves recoverable, sealed segments plus a manifest.
   (Implemented in Phase 2; the recovery test is written before the happy path.)
2. **Tracks stay separate until export.** Screen, camera, mic, system audio, and
   the annotation overlay are separate `Track`s against one monotonic session
   clock. Nothing is flattened at capture time — every downstream edit
   (reposition the webcam, duck system audio, delete a track) depends on it.

## IPC

Every message crossing the preload bridge is defined once in
[`packages/shared/src/ipc`](../packages/shared/src/ipc) and **validated with Zod
at both ends** — the main process validates the request before acting; the
renderer validates the response before trusting it. See [IPC.md](./IPC.md).

## Offline-first

Local recording, editing, and export must function with **zero network**. Cloud
features (LiveKit meetings, share links, cloud transcription) are strictly
additive and always optional. No media, transcript, or telemetry leaves the
device unless the user explicitly enables a cloud feature.

## Security posture (from commit one, not retrofitted)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Strict CSP installed as a response header (see `src/main/security.ts`).
- Minimal preload surface — explicit methods only, no generic `invoke`.
- The recording indicator is always visible and cannot be disabled.
- Redacted pixels are never written to disk (redaction applied at capture).

## Repository layout

```
apps/
  desktop/   Electron app (main · preload · renderer)
  server/    Fastify signaling (LiveKit tokens, share links) — Phase 8
packages/
  shared/      Zod schemas, types, IPC contract, constants   ← everything builds on this
  capture/     source enumeration, region capture, tracks     (Phase 1/3)
  encoder/     WebCodecs + FFmpeg, append-only segment writer  (Phase 2)
  compositor/  WebGL2 scene graph, transitions, effects        (Phase 9)
  overlay/     cursor zoom, annotation, redaction, markers     (Phase 4)
  timeline/    editing model, ripple ops, transcript sync      (Phase 6)
  ui/          shared design system
e2e/           Playwright end-to-end tests
docs/          ARCHITECTURE.md · IPC.md · DECISIONS/ (ADRs)
```

Decisions that deviate from the build spec — or make a significant tradeoff —
are recorded as ADRs in [`docs/DECISIONS`](./DECISIONS).
