import { join } from 'node:path';
import type { OrphanedRecording, RecoveryResult } from '@novarec/shared';
import { nodeDisk, type DiskIO } from './disk.js';
import {
  MANIFEST_FILENAME,
  parseEvents,
  reduceEvents,
  sealedSegments,
  serializeEvent,
  totalDurationMs,
  type ManifestState,
} from './manifest.js';

const encoder = new TextEncoder();

export type { OrphanedRecording, RecoveryResult };

/**
 * Find recordings that never received a terminal `stop` — i.e. the app crashed
 * or was killed mid-recording. These are offered for recovery on next launch.
 */
export async function scanForOrphans(
  vaultDir: string,
  disk: DiskIO = nodeDisk,
): Promise<OrphanedRecording[]> {
  const entries = await disk.readdir(vaultDir).catch(() => [] as string[]);
  const orphans: OrphanedRecording[] = [];

  for (const entry of entries) {
    const dir = join(vaultDir, entry);
    const manifestPath = join(dir, MANIFEST_FILENAME);
    let state: ManifestState;
    try {
      if (!(await disk.exists(manifestPath))) continue;
      state = reduceEvents(parseEvents(await disk.readText(manifestPath)));
    } catch {
      // One unreadable manifest (locked by antivirus or a sync client) must not
      // hide every other recording that needs recovering. Skip it this time;
      // the next scan will try it again.
      continue;
    }
    if (state.stopped) continue; // cleanly finalized or already recovered

    orphans.push({
      dir,
      recordingId: state.recordingId,
      createdAt: state.createdAt,
      status: state.status,
      sealedSegmentCount: sealedSegments(state).length,
      durationMs: totalDurationMs(state),
    });
  }

  return orphans;
}

/**
 * Reconstruct a playable file from an orphaned recording by concatenating the
 * init segment with every sealed fragment (a valid fragmented MP4). The torn,
 * unsealed trailing segment is dropped. Marks the manifest `recovered`.
 */
/**
 * Concatenate a track's init + sealed fMP4 fragments into a single playable
 * `track.mp4` (the same byte-concat as recovery, without marking recovered).
 * Used to finalize each track before export. Returns null if nothing sealed.
 */
/**
 * Ordered list of on-disk files (init + sealed fragments) that make up a
 * playable track, in the order they must be concatenated.
 */
function trackFiles(dir: string, state: ManifestState): string[] {
  const files: string[] = [];
  if (state.initSegment) files.push(join(dir, state.initSegment));
  for (const seg of sealedSegments(state)) files.push(join(dir, seg.path));
  return files;
}

/**
 * Detect the real container of the captured fragments. MediaRecorder prefers
 * `video/mp4` but silently falls back to WebM on hosts that can't record MP4;
 * the bytes are then WebM (EBML) regardless of the `.mp4` segment filenames, so
 * a recovered file must carry the matching extension or players reject it.
 */
async function detectExtension(firstFile: string | undefined, disk: DiskIO): Promise<string> {
  if (!firstFile) return '.mp4';
  try {
    const head = await disk.readFile(firstFile);
    // EBML magic (Matroska/WebM): 0x1A45DFA3.
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      return '.webm';
    }
  } catch {
    // fall through to the default
  }
  return '.mp4';
}

export async function finalizeTrack(
  dir: string,
  disk: DiskIO = nodeDisk,
): Promise<{ path: string; durationMs: number } | null> {
  const state = reduceEvents(parseEvents(await disk.readText(join(dir, MANIFEST_FILENAME))));
  if (sealedSegments(state).length === 0) return null;

  // Extension is irrelevant here — the output feeds FFmpeg, which demuxes by
  // content — but keep it correct so a stray track file is still openable.
  const files = trackFiles(dir, state);
  const path = join(dir, `track${await detectExtension(files[0], disk)}`);
  await disk.concatToFile(path, files);
  return { path, durationMs: totalDurationMs(state) };
}

export async function recoverRecording(
  dir: string,
  disk: DiskIO = nodeDisk,
): Promise<RecoveryResult> {
  const manifestPath = join(dir, MANIFEST_FILENAME);
  const text = await disk.readText(manifestPath);
  const state = reduceEvents(parseEvents(text));
  const sealed = sealedSegments(state);

  const files = trackFiles(dir, state);
  const outputPath = join(dir, `recovered${await detectExtension(files[0], disk)}`);
  await disk.concatToFile(outputPath, files);

  const durationMs = totalDurationMs(state);
  // A crash mid-append leaves a torn last line with no newline. Appending the
  // stop straight after it would fuse the two into one unparseable line, the
  // stop would be lost, and the same recording would be offered again on
  // every launch. Start a fresh line first.
  const separator = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
  await disk.appendAndSync(
    manifestPath,
    encoder.encode(
      separator + serializeEvent({ type: 'stop', atMs: durationMs, status: 'recovered' }),
    ),
  );

  return { recordingId: state.recordingId, outputPath, segmentCount: sealed.length, durationMs };
}
