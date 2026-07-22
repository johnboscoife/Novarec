# ADR 0005 — Recording capture uses MediaRecorder, not WebCodecs+mp4box (yet)

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 2
- **Deviation from:** the approved Phase 2 plan (which specified a WebCodecs
  `VideoEncoder` worker muxing with mp4box.js).

## Context

Phase 2's job is the durable recording path. The tested core — the append-only
manifest, segment writer, and crash recovery in `@novarec/encoder` — is
byte-agnostic: it persists whatever fragments it's handed. What remained was
choosing how the renderer produces those fragments.

The plan called for WebCodecs + mp4box.js. Building it revealed two problems for
_this_ phase:

1. **It can't be verified in the build sandbox.** Real encoding needs GPU +
   live capture. Hand-rolled mp4box muxing (ISOFile, addSample, segmentation
   callbacks) is intricate and easy to get subtly wrong, and none of it is
   exercisable by the automated suite here.
2. **This is a "never lose a recording" phase** where reliability outranks
   encode-control.

## Decision

Use **MediaRecorder** as the Phase 2 capture source. It emits fragmented-MP4
chunks (first chunk carries the init/moov; the rest are moof+mdat fragments that
concatenate into a valid file), encodes in Chromium's media pipeline off the UI
thread, and is a boring, well-supported API. Each chunk streams to main and
lands via the tested `SegmentWriter`. No separate init file is needed — the moov
rides in the first sealed segment, and recovery concatenates sealed segments.

**WebCodecs + mp4box.js moves to Phase 7 (Export)**, where fine-grained control
(codec, bitrate mode, keyframe placement, HW-encoder selection, AV1/HEVC) is the
actual requirement and there's a natural place to validate output quality.

## Consequences

- Phase 2 ships a reliable recording path whose durability guarantees are fully
  unit-tested, independent of the encoder.
- Codec/quality control for _recording_ is limited to what MediaRecorder
  exposes until the WebCodecs path lands for export.
- The `recording:writeInit` IPC channel exists but is unused by the MediaRecorder
  path; it's ready for the WebCodecs path, which produces a distinct init segment.

## Alternatives considered

- **WebCodecs + mp4box.js now** — matches the plan but ships un-verifiable
  muxing code in the one phase where correctness matters most. Deferred, not
  dropped.
- **FFmpeg child process fed raw frames** — heavier, and piping raw frames from
  the renderer is its own large surface; not warranted here.
