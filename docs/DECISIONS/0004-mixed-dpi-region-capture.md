# ADR 0004 — Mixed-DPI region capture and snap targets

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 1

## Context

Region capture must work across multiple monitors, including a **mixed-DPI**
setup (e.g. a 1× 1080p display beside a 2× 4K display). The Phase 1 acceptance
explicitly requires capturing a region that spans two monitors at 60fps. Two
coordinate systems collide: Electron's `screen` API reports **DIP** in one
virtual-desktop space, while capture crops are in **physical pixels** relative
to a single display's framebuffer.

## Decision

### Coordinate model

- The region is authored and stored in **DIP, virtual-desktop coordinates**
  (`SavedRegion.rect`). This is resolution-independent and survives display
  reconfiguration better than physical coordinates.
- `packages/capture/geometry.ts` converts to capture instructions with
  `splitRectByDisplays(displays, region)`: intersect the region with each
  display, and for each intersection emit a **physical crop** scaled by _that
  display's_ `scaleFactor`, relative to _that display's_ origin.

### Cross-monitor capture = capture-per-display, then composite

A single rectangle spanning two displays with different scale factors has no
single physical crop. We capture each display's slice at its own scale and let
the compositor stitch them into the region's output. Phase 1 delivers the
geometry (unit-tested, including the mixed-DPI case) and the region selection;
the multi-source stitching is wired into the recorder/compositor in Phase 2/3.

### Snap targets: display edges now, window edges later

The selection overlay snaps to **display edges** (available from `screen`).
True **snap-to-window** needs every window's bounds, which Electron does not
expose without a native module. Window-edge snapping is deferred behind the same
`snapRectEdges(rect, xTargets, yTargets, threshold)` function — it only needs a
window-bounds provider fed into the target lists. The limitation is surfaced in
the overlay hint rather than failing silently.

## Consequences

- Region geometry is correct on mixed-DPI setups and unit-tested without an OS.
- One clearly-scoped follow-up (native window-bounds enumeration) unlocks
  window-edge snapping; the snapping engine already supports it.

## Alternatives considered

- **Store the region in physical pixels** — rejected; brittle across display
  changes and scale factors, and ambiguous for cross-monitor regions.
- **Capture the whole virtual desktop and crop** — wasteful (encodes pixels we
  discard) and still needs per-display scaling; rejected.
