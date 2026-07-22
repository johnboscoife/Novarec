# Phase 1 — Manual verification checklist

Most of the capture engine is verified automatically (unit tests for geometry
and sustain, typecheck, lint, and the Electron boot smoke test). The parts that
need **real hardware** — a live multi-monitor 60fps capture — can't run in CI or
the build sandbox and must be checked on a physical machine, ideally one with
**two monitors at different scale factors**.

Run `pnpm dev`, open **Record**, then work through:

## Enumeration & DPI

- [ ] The **Screens** list shows every connected display with its resolution,
      scale factor, and a `primary` tag on the right one.
- [ ] The **Windows** list shows open application windows.
- [ ] On a mixed-DPI setup, each display's reported resolution and DPI match
      Windows/macOS display settings.

## Region selection (the differentiator)

- [ ] Clicking **Select a region…** opens a transparent, dimmed overlay across
      **all** monitors (including the secondary display).
- [ ] Drag to draw a selection; the live label shows both DIP size and the
      physical-pixel size of the owning display.
- [ ] Dragging an edge near a **display edge** snaps to it (within ~8px).
- [ ] **Enter** / **Capture** confirms; **Esc** / **Cancel** dismisses.
- [ ] Draw a region that **straddles both monitors**; confirm it's accepted and
      the Region card notes "spans monitors".
- [ ] Quit and relaunch NovaRec — the region is **still there** (persisted).

## Frame-rate sustain probe

- [ ] Select a screen source, pick **60**, click **Test 60 fps on this source**.
- [ ] After ~3s a verdict appears (Sustained / Marginal / Dropping frames) with
      delivered fps, dropped %, jitter, and "can sustain X fps".
- [ ] The delivered fps is close to 60 on capable hardware; picking **120** on a
      60Hz display should report a lower sustainable value.

## Acceptance criterion (spec)

> Capture a region across two monitors at 60fps for 5 minutes with no
> dropped-frame warnings.

- [ ] With a cross-monitor region at 60fps, run the probe repeatedly (or leave a
      capture preview running) and confirm the verdict stays **Sustained** and
      dropped % stays under the 0.1% budget over a sustained run.

> Note: end-to-end 5-minute capture-to-disk is exercised once the segmented
> recorder lands in **Phase 2**; Phase 1 proves frame acquisition and the
> sustain measurement.
