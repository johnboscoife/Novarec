# ADR 0003 — Capture backend: Chromium (desktopCapturer / getUserMedia), not native modules yet

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 1

## Context

The spec lists native capture (Windows.Graphics.Capture, ScreenCaptureKit,
PipeWire) _and_ `desktopCapturer` + WebCodecs. We must acquire frames for the
Record engine (and later Meet screen-share and Studio sources).

## Decision

Phase 1 uses **Chromium's capture path**: `desktopCapturer` (main) enumerates
screens/windows; the renderer acquires frames via `getUserMedia` with
`chromeMediaSource: 'desktop'`. On Windows 10+, Chromium already implements this
on top of **Windows.Graphics.Capture**; on macOS via **ScreenCaptureKit**; on
Linux via **PipeWire**. So we get the native APIs' behavior without shipping and
maintaining three native N-API addons and their CI toolchains.

A `capture` seam keeps the door open: the pure geometry/sustain logic and the
`CaptureSource` model are backend-agnostic, so a native backend can be added
later behind the same interface if we hit a concrete wall (HDR, a capture mode
Chromium refuses, or a performance ceiling).

### Sub-decision: the sustain probe is not worker-based (deviation from the plan)

The Phase 1 plan said the probe would run in a Web Worker. In implementation, a
worker + `MediaStreamTrackProcessor` (with transferable tracks) added real
complexity and browser-version risk for a **3-second diagnostic**. The probe
instead counts delivered frames on the render thread via
`requestVideoFrameCallback` — cheap and accurate, and it does not meaningfully
block React. The **recording hot path** (Phase 2/3), where frames are
continuously encoded, _will_ run off the UI thread in a worker (WebCodecs). The
non-negotiable "capture thread never touches UI thread" rule targets that
sustained path, not a one-off probe.

## Consequences

- No native build toolchain in CI for Phase 1; installers stay simple.
- Frame acquisition is subject to Chromium's constraints and defaults.
- A future ADR will cover a native backend if/when it's justified.

## Alternatives considered

- **Native capture modules now** — rejected for Phase 1: three platform addons
  is a large, high-risk surface for capability Chromium already provides.
