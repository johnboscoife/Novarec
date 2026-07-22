# ADR 0007 — One input-driven overlay engine

- **Status:** Accepted
- **Date:** 2026-07-22
- **Phase:** 4

## Context

The spec's differentiator is cursor zoom, click emphasis, annotation,
redaction, markers, and teleprompter — and it insists these be "a single
input-driven overlay system, not four separate features."

## Decision

Model everything as **time-indexed data resolved by pure functions**, rendered
later by the compositor:

- **Cursor zoom** — the cursor-event track drives `generateZoomKeyframes()`,
  which clusters activity and emits editable/deletable zoom-and-pan keyframes;
  `sampleZoomAt()` interpolates state at any instant (live preview or export).
- **Redaction** — zones resolved by `activeRedactions()`; window-following via
  `resolveRedactionRect()`; a credential-detection preset builds solid zones.
  Applied at capture so sensitive pixels never reach disk.
- **Annotations** — one `Annotation` model for pen/arrow/shapes/highlighter/
  text/laser on the overlay track (erasable after the fact); the laser's fade is
  a pure function of time (`laserOpacityAt`), so the same math runs live and on
  export.
- **Markers → chapters** — `markersToChapters()` produces export chapter points.

All of this is pure and unit-tested (no canvas, no capture), which is what lets
the "brain" of the differentiator be verified without hardware.

## Consequences

- Every overlay effect is data the editor can edit or delete; nothing is baked
  in until export.
- Live rendering (WebGL2) and capture-time recording of the cursor-event track
  (`screen.getCursorScreenPoint()` polling + click hooks) layer on top of these
  pure cores; they're integration, not logic, and land with the compositor
  (Phase 9) and the editor (Phase 6).

## Alternatives considered

- **Four independent features** — explicitly rejected by the spec; would
  duplicate timing/track handling and prevent shared editing.
- **Bake effects at capture** — rejected except redaction (which must be baked
  for security); everything else stays editable until export.
