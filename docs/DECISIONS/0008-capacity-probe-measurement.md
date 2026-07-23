# 0008 — Capacity probe measures true capacity, not an idle screen

- Status: accepted
- Date: 2026-07-23

## Context

The Record view's "Capacity check" probes capture for ~3 seconds and reports the
FPS the machine can sustain. In the field it consistently reported catastrophic
results on capable machines — e.g. 4.9 fps delivered, 83.7% dropped, 508 ms
jitter — which we initially chased as a performance/encoder problem across
several iterations (ADR-0003, ADR-0005).

Two measurement bugs, not a hardware limit, produced those numbers:

1. **Screen capture is change-driven.** Chromium's `getDisplayMedia` screen
   capturer only emits a frame when the captured picture changes. During the
   probe the user stares at a static settings panel, so the capturer legitimately
   delivers a handful of sporadic frames (cursor blink, scrollbar). The probe
   scored that idle screen as "83.7% dropped." The huge inter-frame jitter
   (~508 ms) is the signature of sporadic change-driven delivery, not load.

2. **Hidden `<video>` frame callbacks are throttled.** We counted frames with
   `requestVideoFrameCallback` on a 2px, `opacity:0` video element. Chromium
   rate-limits frame presentation for occluded/invisible elements, further
   under-counting real captured frames.

## Decision

The probe now measures **true sustainable capacity**:

- **Drive on-screen motion for the probe window.** A thin, continuously
  animating bar is painted at the top of the screen for the 3s test so the
  desktop capturer sees constant change and runs at its target rate. Delivered-
  vs-target then reflects what the machine can actually hold, not whether the
  screen happened to be still.
- **Count real captured frames via `MediaStreamTrackProcessor`.** Frames are read
  straight off the video track's `ReadableStream<VideoFrame>`, which is immune to
  compositor throttling of hidden elements. A guard timer cancels the reader so a
  fully static source can't hang past the window. The attached hidden `<video>` +
  `requestVideoFrameCallback` path remains as a fallback for engines without the
  processor.

The pure metric math in `@novarec/capture` (`computeProbeMetrics`,
`sustainVerdict`, `maxSustainableFps`) is unchanged — only the timestamps feeding
it are now correct. The UI gained a one-line explanation that the test animates
the screen because a still screen is not a real result.

## Consequences

- The capacity check stops misdiagnosing idle screens as dropped frames and now
  disambiguates "static screen" from a genuine encode bottleneck — if numbers
  stay low _with_ motion driving, that is a real signal that would justify the
  WebCodecs hardware-encode path.
- A faint animated bar is visible at the top of the screen for the 3s probe. It
  is `aria-hidden`, non-interactive, and torn down immediately after.
- `MediaStreamTrackProcessor` is not yet in the TS DOM lib; a minimal local
  interface types the two members we use.
