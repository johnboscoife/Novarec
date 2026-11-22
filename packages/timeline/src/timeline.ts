/**
 * The editing model: an immutable set of clips per track and pure operations
 * over them (split, trim, ripple-delete, remove-range). "Remove range" is the
 * engine behind transcript-based editing and silence removal — delete a span of
 * time and everything after it ripples left. Pure, so every edit is unit-tested.
 */
export interface Clip {
  id: string;
  trackId: string;
  sourceInMs: number;
  sourceOutMs: number;
  timelineStartMs: number;
}

export interface TimeRange {
  startMs: number;
  endMs: number;
}

export function clipDuration(clip: Clip): number {
  return clip.sourceOutMs - clip.sourceInMs;
}

export function clipTimelineEnd(clip: Clip): number {
  return clip.timelineStartMs + clipDuration(clip);
}

export function timelineDuration(clips: readonly Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, clipTimelineEnd(c)), 0);
}

function byTimeline(a: Clip, b: Clip): number {
  return a.timelineStartMs - b.timelineStartMs;
}

/**
 * An id derived from `base` that no clip in `taken` has yet, and reserve it.
 * Splitting `x` gives `x:2`; splitting the original `x` again must not produce
 * a second `x:2`, or every later id-based edit (trim, delete) hits both.
 */
function freshId(taken: Set<string>, base: string, suffix: string): string {
  let id = `${base}:${suffix}`;
  for (let n = 2; taken.has(id); n += 1) id = `${base}:${suffix}${n}`;
  taken.add(id);
  return id;
}

/** Split a clip at a timeline position that falls strictly inside it. */
export function splitClip(clips: readonly Clip[], clipId: string, atTimelineMs: number): Clip[] {
  const result: Clip[] = [];
  const taken = new Set(clips.map((c) => c.id));
  for (const clip of clips) {
    if (
      clip.id !== clipId ||
      atTimelineMs <= clip.timelineStartMs ||
      atTimelineMs >= clipTimelineEnd(clip)
    ) {
      result.push(clip);
      continue;
    }
    const offset = atTimelineMs - clip.timelineStartMs;
    result.push({ ...clip, sourceOutMs: clip.sourceInMs + offset });
    result.push({
      ...clip,
      id: freshId(taken, clip.id, '2'),
      sourceInMs: clip.sourceInMs + offset,
      timelineStartMs: atTimelineMs,
    });
  }
  return result;
}

/** Adjust a clip's source in/out points (does not ripple neighbors). */
export function trimClip(
  clips: readonly Clip[],
  clipId: string,
  inMs: number,
  outMs: number,
): Clip[] {
  return clips.map((clip) =>
    clip.id === clipId
      ? { ...clip, sourceInMs: Math.min(inMs, outMs), sourceOutMs: Math.max(inMs, outMs) }
      : clip,
  );
}

/** Remove a clip and shift later clips on the same track left by its duration. */
export function rippleDelete(clips: readonly Clip[], clipId: string): Clip[] {
  const target = clips.find((c) => c.id === clipId);
  if (!target) return [...clips];
  const gap = clipDuration(target);
  return clips
    .filter((c) => c.id !== clipId)
    .map((c) =>
      c.trackId === target.trackId && c.timelineStartMs >= target.timelineStartMs
        ? { ...c, timelineStartMs: c.timelineStartMs - gap }
        : c,
    )
    .sort(byTimeline);
}

/**
 * Cut [fromMs, toMs) from a track and ripple everything after it left. Clips
 * spanning the cut are split; fully-covered clips are dropped. This is what a
 * transcript deletion or a silence removal ultimately calls.
 */
export function removeTimelineRange(
  clips: readonly Clip[],
  trackId: string,
  fromMs: number,
  toMs: number,
): Clip[] {
  if (toMs <= fromMs) return [...clips];
  const rangeLen = toMs - fromMs;
  const result: Clip[] = [];
  const taken = new Set(clips.map((c) => c.id));

  for (const clip of clips) {
    if (clip.trackId !== trackId) {
      result.push(clip);
      continue;
    }
    const start = clip.timelineStartMs;
    const end = clipTimelineEnd(clip);

    if (end <= fromMs) {
      result.push(clip); // entirely before the cut
      continue;
    }
    if (start >= toMs) {
      result.push({ ...clip, timelineStartMs: start - rangeLen }); // entirely after
      continue;
    }
    // Overlaps the cut — keep the parts outside it.
    if (start < fromMs) {
      result.push({ ...clip, sourceOutMs: clip.sourceInMs + (fromMs - start) });
    }
    if (end > toMs) {
      result.push({
        ...clip,
        id: freshId(taken, clip.id, 'r'),
        sourceInMs: clip.sourceInMs + (toMs - start),
        timelineStartMs: fromMs,
      });
    }
    // Fully covered (start >= fromMs && end <= toMs): dropped.
  }
  return result.sort(byTimeline);
}

/**
 * Merge overlapping or touching ranges into disjoint ones, in time order.
 * Empty and inverted ranges are dropped.
 */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.endMs > r.startMs)
    .map((r) => ({ startMs: r.startMs, endMs: r.endMs }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged: TimeRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.startMs <= last.endMs) last.endMs = Math.max(last.endMs, range.endMs);
    else merged.push(range);
  }
  return merged;
}

/**
 * Apply a batch of cut ranges (e.g. all fillers) to a track, right-to-left.
 *
 * Ranges are merged first. Overlapping cuts are normal — a filler word inside
 * a silence — and applied one by one, the later cut would ripple content left
 * underneath the earlier one, which would then delete material nobody chose.
 */
export function removeRanges(
  clips: readonly Clip[],
  trackId: string,
  ranges: readonly TimeRange[],
): Clip[] {
  // Latest first so earlier offsets stay valid.
  const ordered = mergeRanges(ranges).reverse();
  let current = [...clips];
  for (const range of ordered) {
    current = removeTimelineRange(current, trackId, range.startMs, range.endMs);
  }
  return current;
}
