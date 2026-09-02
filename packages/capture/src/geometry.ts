import type { Rect, DisplayInfo } from '@novarec/shared';

/**
 * Display geometry math for the capture engine. All coordinates that come from
 * Electron's `screen` API are in **DIP** (device-independent pixels) laid out in
 * one virtual-desktop space; capture crops must be in **physical pixels** and
 * relative to a single display's framebuffer. Getting this wrong is how you ship
 * a screen recorder that captures the wrong region on a HiDPI monitor.
 *
 * Every function here is pure so it can be unit-tested without an OS.
 */

// `DisplayInfo` is defined in @novarec/shared (it crosses the IPC boundary);
// re-exported here because this module is its primary consumer.
export type { DisplayInfo };

/** One display's slice of a (possibly cross-monitor) capture region. */
export interface DisplayCaptureSlice {
  displayId: number;
  /** The portion of the region on this display, in DIP virtual coordinates. */
  dipRect: Rect;
  /** The crop within this display's framebuffer, in physical px from its origin. */
  physicalRect: Rect;
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectIntersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export function rectOverlapArea(a: Rect, b: Rect): number {
  const i = rectIntersection(a, b);
  return i ? i.width * i.height : 0;
}

export function virtualDesktopBounds(displays: readonly DisplayInfo[]): Rect {
  if (displays.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of displays) {
    minX = Math.min(minX, d.bounds.x);
    minY = Math.min(minY, d.bounds.y);
    maxX = Math.max(maxX, rectRight(d.bounds));
    maxY = Math.max(maxY, rectBottom(d.bounds));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function displayContainingPoint(
  displays: readonly DisplayInfo[],
  x: number,
  y: number,
): DisplayInfo | null {
  for (const d of displays) {
    const withinX = x >= d.bounds.x && x < rectRight(d.bounds);
    const withinY = y >= d.bounds.y && y < rectBottom(d.bounds);
    if (withinX && withinY) return d;
  }
  return null;
}

/** The display the region overlaps most (ties resolve to the first display). */
export function displayForRect(displays: readonly DisplayInfo[], rect: Rect): DisplayInfo | null {
  let best: DisplayInfo | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const area = rectOverlapArea(rect, d.bounds);
    if (area > bestArea) {
      best = d;
      bestArea = area;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keep a rect fully inside `bounds`, shrinking it if it is larger. */
export function clampRectToBounds(rect: Rect, bounds: Rect): Rect {
  const width = Math.min(rect.width, bounds.width);
  const height = Math.min(rect.height, bounds.height);
  const x = clamp(rect.x, bounds.x, rectRight(bounds) - width);
  const y = clamp(rect.y, bounds.y, rectBottom(bounds) - height);
  return { x, y, width, height };
}

/** Convert a DIP rect on a display to physical px relative to the display origin. */
export function dipToPhysicalRect(dipRect: Rect, display: DisplayInfo): Rect {
  const s = display.scaleFactor;
  return {
    x: (dipRect.x - display.bounds.x) * s,
    y: (dipRect.y - display.bounds.y) * s,
    width: dipRect.width * s,
    height: dipRect.height * s,
  };
}

/**
 * Split a region into per-display capture instructions. A region straddling two
 * monitors yields one slice per display, each with its own physical crop scaled
 * by that display's factor — the compositor stitches them back together.
 */
export function splitRectByDisplays(
  displays: readonly DisplayInfo[],
  region: Rect,
): DisplayCaptureSlice[] {
  const slices: DisplayCaptureSlice[] = [];
  for (const d of displays) {
    const dipRect = rectIntersection(region, d.bounds);
    if (!dipRect) continue;
    slices.push({
      displayId: d.id,
      dipRect,
      physicalRect: dipToPhysicalRect(dipRect, d),
    });
  }
  return slices;
}

/** Snap a coordinate to the nearest guide within `threshold`, else return it. */
export function snapValue(value: number, targets: readonly number[], threshold: number): number {
  let snapped = value;
  let bestDist = threshold;
  for (const t of targets) {
    const dist = Math.abs(value - t);
    if (dist <= bestDist) {
      bestDist = dist;
      snapped = t;
    }
  }
  return snapped;
}

/** Snap each edge of a rect independently to nearby vertical/horizontal guides. */
export function snapRectEdges(
  rect: Rect,
  xTargets: readonly number[],
  yTargets: readonly number[],
  threshold: number,
): Rect {
  const left = snapValue(rect.x, xTargets, threshold);
  const right = snapValue(rectRight(rect), xTargets, threshold);
  const top = snapValue(rect.y, yTargets, threshold);
  const bottom = snapValue(rectBottom(rect), yTargets, threshold);
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/**
 * A crop to apply to a captured video frame so only the selected region is
 * recorded: the source rect to read (in captured-frame pixels) and the encoded
 * output size.
 */
export interface RegionCrop {
  /** Source rect inside the captured frame, in that frame's pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Encoded output size — even numbers (H.264 requires even dimensions). */
  outWidth: number;
  outHeight: number;
}

/** Round down to an even number, with a floor of 2 (H.264 needs even dims). */
function toEven(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * Map a DIP region on a display to a crop within the frames actually delivered
 * by `getDisplayMedia` for that display.
 *
 * The frame is the whole display, possibly downscaled by Chromium (we cap
 * capture resolution), so the mapping is a pure ratio of frame pixels to the
 * display's DIP bounds — never the display's own scale factor, which does not
 * survive that downscale.
 *
 * Returns null when there is nothing to crop: no overlap with the captured
 * display, a degenerate rect, or a region that already covers the whole frame
 * (cropping then would only cost a canvas pass). A null result means "record the
 * source as-is", never "silently record the wrong thing".
 */
export function cropForRegion(
  region: Rect,
  displayBounds: Rect,
  videoWidth: number,
  videoHeight: number,
  maxOutWidth = 1920,
  maxOutHeight = 1080,
): RegionCrop | null {
  if (videoWidth <= 0 || videoHeight <= 0) return null;
  if (displayBounds.width <= 0 || displayBounds.height <= 0) return null;

  const visible = rectIntersection(region, displayBounds);
  if (!visible) return null;

  const scaleX = videoWidth / displayBounds.width;
  const scaleY = videoHeight / displayBounds.height;

  const left = clamp(Math.round((visible.x - displayBounds.x) * scaleX), 0, videoWidth);
  const top = clamp(Math.round((visible.y - displayBounds.y) * scaleY), 0, videoHeight);
  const sw = clamp(Math.round(visible.width * scaleX), 0, videoWidth - left);
  const sh = clamp(Math.round(visible.height * scaleY), 0, videoHeight - top);
  if (sw < 2 || sh < 2) return null;

  // Already the whole frame (within a rounding pixel) — nothing to crop.
  if (sw >= videoWidth - 1 && sh >= videoHeight - 1) return null;

  // Downscale only if the region is larger than the output ceiling; a small
  // region keeps its native pixels instead of being upscaled.
  const fit = Math.min(1, maxOutWidth / sw, maxOutHeight / sh);
  return {
    sx: left,
    sy: top,
    sw,
    sh,
    outWidth: toEven(sw * fit),
    outHeight: toEven(sh * fit),
  };
}

/**
 * Convert a rect measured inside a per-display overlay into virtual-desktop DIP
 * coordinates. The overlay covers exactly one display, so its CSS pixels are
 * that display's DIP and the conversion is a pure translation by the display
 * origin — no scale factor is involved (the frame the user drew on is already
 * in DIP, whatever the monitor's DPI).
 */
export function overlayRectToVirtual(localRect: Rect, displayBounds: Rect): Rect {
  return {
    x: displayBounds.x + localRect.x,
    y: displayBounds.y + localRect.y,
    width: localRect.width,
    height: localRect.height,
  };
}
