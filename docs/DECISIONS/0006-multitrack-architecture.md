# ADR 0006 — Multi-track capture: one SegmentWriter per track

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 3

## Context

A recording captures screen, camera, mic, and system audio as **separate,
time-aligned tracks** that stay separate until export. Phase 2 shipped a durable,
unit-tested single-track `SegmentWriter`.

## Decision

Rather than teach the writer about multiple tracks, run **one `SegmentWriter`
per track**, each in its own subdirectory:

```
<vault>/<recordingId>/
  screen/       manifest.jsonl + seg-*.mp4
  camera/       manifest.jsonl + seg-*.mp4
  microphone/   manifest.jsonl + seg-*.mp4
  systemAudio/  manifest.jsonl + seg-*.mp4
```

All tracks share one `createdAt` session clock. This reuses every Phase-2
durability guarantee (append-only manifest, fsync-on-seal, crash recovery)
unchanged, per track. The main-process session fans start/pause/resume/stop out
to each track's writer; orphan scan and recovery group per-track results by
recording.

### Sync model

Tracks are captured independently, so alignment is data, not luck. `sessionOffsets`
normalizes each track's start to the earliest; `syncDriftMs` measures the spread
between track **endpoints** (start offset + duration), which captures both
start jitter and clock-rate divergence. `withinDriftBudget(tracks, 40)` asserts
the spec's < 40ms budget. These are pure and unit-tested.

### System audio

Windows uses loopback via `chromeMediaSource: 'desktop'` audio capture. macOS
(ScreenCaptureKit audio, 13+) and Linux (PipeWire) get documented fallbacks in
later platform passes; where unavailable, the track simply can't be enabled and
the UI says so rather than failing silently.

## Consequences

- Zero changes to the tested writer/recovery core; multi-track is pure
  composition plus grouping in the session layer.
- A recording is a directory of track directories — trivially inspectable, and
  each track independently recoverable.
- `recording:start` now takes a `TrackConfig[]`; `writeInit`/`writeFragment`
  carry a `trackId` (breaking change to the Phase-2 single-track IPC).

## Alternatives considered

- **One manifest with multiple track segment lists** — would require
  reworking and re-testing the writer; rejected for no benefit.
- **Interleave all tracks into one container at capture** — violates
  "tracks stay separate until export"; rejected outright.
