# NovaRec — build status

Built phase-by-phase from `NovaRec-build-prompt.md`. Every phase's
correctness-critical logic is delivered as **pure, unit-tested code**; the
platform-native and live-media integration on top of it is called out per phase
and, where it can't run in CI/sandbox, has a manual checklist.

## Phase completion

| Phase         | Tested core (automated)                                                 | Integration / manual (real machine)                    |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| 0 Foundation  | monorepo, strict TS, IPC contract, CI                                   | — (installer verified)                                 |
| 1 Capture     | geometry/DPI/mixed-DPI split, region crop, FPS sustain, sources         | live multi-monitor 60fps → `PHASE-1-VERIFICATION.md`   |
| 2 Recorder    | append-only manifest, segment writer, **crash recovery**, disk-full     | real capture→disk→playback → `PHASE-2-VERIFICATION.md` |
| 3 Multi-track | per-track writers, A/V sync drift model                                 | 4-track sync on hardware                               |
| 4 Overlay     | cursor-zoom keyframes, redaction, **markers→chapters (shipped)**, laser | WebGL2 render + cursor-event capture                   |
| 5 Hotkeys     | accelerator normalize, conflict detection, countdown                    | globalShortcut registration (in app)                   |
| 6 Editor      | timeline ops (split/trim/ripple/remove-range), transcript cuts, silence | Whisper transcription, editor UI                       |
| 7 Export      | FFmpeg argv builder, presets, export queue                              | bundled FFmpeg execution, hw fallback, ffprobe         |
| 8 Meet        | LiveKit token signing (HS256), consent ledger, token route              | LiveKit SFU deploy, meeting UI                         |
| 9 Studio      | compositor transform/scene math, stream targets, adaptive bitrate       | WebGL2 program, RTMP egress, virtual camera            |
| 10 Polish     | telemetry opt-in gate, app settings                                     | onboarding UI, signing/notarization, a11y audit        |

## Cross-cutting guarantees encoded as tests

- **Never lose a recording** — append-only manifest + fsync-on-seal + crash
  recovery, proved by a real killed-subprocess test and disk-full injection.
- **Tracks stay separate until export** — per-track segment writers.
- **No telemetry without opt-in** — `prepareTelemetry` returns null unless opted
  in and strips PII; default settings are opt-out.
- **Recording consent** — `allConsented` gates meeting recording.
- **No `any`, strict TS, Zod-validated IPC both ends** — enforced by ESLint + CI.

## Architecture decisions

See `docs/DECISIONS/` — ADR-0001..0007 record the monorepo/tooling, version
strategy, capture backend, mixed-DPI region model, MediaRecorder choice,
multi-track architecture, and the overlay engine.

## Region capture

The picked area is applied where it can be: `getDisplayMedia` only ever returns a
whole display, so `cropForRegion` (pure, in `@novarec/capture`) maps the DIP
region onto the delivered frame, and `cropStream.ts` in the renderer draws that
crop onto a canvas whose `captureStream` is what the encoder sees. The recording
is cropped at the source, so finalize and export need no knowledge of regions.
An area that does not overlap the captured display is an error, never a silent
full-screen recording.

## How a recording finishes

By default a take is captured as ONE already-muxed file: the screen (with the
camera composited picture-in-picture when there is one) and every audio source
mixed at capture time. Stopping re-wraps that file into MP4 or MKV with a stream
copy — disk speed, no re-encode, no queue. MP4 additionally converts the audio,
because Chromium can record Opus, which is legal in MP4 but rejected by
QuickTime and most editors; the video is never re-encoded either way.

Separate-track recording remains available and unchanged for takes that need
the audio balanced afterwards. It still requires a real export, which is where
compositing and transcoding live.

The durable segment/manifest layer sits underneath both modes, so crash recovery
is identical either way.

## Markers and chapters

Pressing the marker shortcut (or **Mark**) during a take appends to
`markers.jsonl` in the recording's own folder — append-only, written as it
happens, so a bookmark survives whatever the footage survives. On export those
markers become real chapters in the MP4 via an FFMETADATA input, verified
against FFmpeg rather than assumed.

`annotateToggle` and `cursorZoomNow` remain in the hotkey model for the overlay
engine but are **deliberately unbound**: registering a system-wide shortcut that
does nothing takes the combination away from every other app and tells the user
a lie.

## Not yet built (integration layers)

The native/live surfaces above (WebGL2 renderer, whisper.cpp, bundled FFmpeg
egress, LiveKit SFU, virtual-camera drivers, signed installers, full editor/
studio/meet UIs) are the next work. Each sits behind a tested core that defines
its behavior, so they are wiring against a verified contract rather than
green-field logic.
