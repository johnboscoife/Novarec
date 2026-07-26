import { randomUUID } from 'node:crypto';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { app } from 'electron';
import {
  DiskFullError,
  SegmentWriter,
  recoverRecording,
  scanForOrphans,
  sealedSegments,
  totalDurationMs,
} from '@novarec/encoder';
import {
  trackMediaKind,
  type OrphanedRecording,
  type RecordingStatus,
  type RecordingSummary,
  type RecoveryResult,
  type TrackConfig,
} from '@novarec/shared';
import { getStorageLocation } from '../app-state.js';

/**
 * Multi-track recording. Each enabled track is an independent, durable
 * SegmentWriter in its own subdirectory (`<vault>/<recordingId>/<trackId>/`),
 * sharing one createdAt session clock. Tracks stay separate until export.
 */
interface TrackWriter {
  writer: SegmentWriter;
  started: boolean;
}
interface Session {
  dir: string;
  tracks: Map<string, TrackWriter>;
}

const sessions = new Map<string, Session>();
// Remember recently finalized recordings so a Stop that arrives after an
// internal auto-finalize (disk-full, or a double-stop) resolves with the real
// summary instead of throwing and wedging the UI. Bounded — recordings are few.
const finalizedSummaries = new Map<string, RecordingSummary>();
const MAX_REMEMBERED = 24;

/** True if `dir` is the vault root or strictly inside it (separator-anchored,
 * so a sibling like `<vault>-backup` can't pass a bare prefix check). */
export function isInsideVault(dir: string): boolean {
  const root = resolve(vault());
  const target = resolve(dir);
  return target === root || target.startsWith(root + sep);
}

function vault(): string {
  // A user-chosen storage folder (Settings → Storage) overrides the default
  // app-data vault. Read from the synchronous cache so all vault-scoped checks
  // stay sync. New recordings land here; existing ones stay where they were.
  const custom = getStorageLocation();
  return custom ?? join(app.getPath('userData'), 'recordings');
}

/** The recordings vault path, so the UI can reveal it in the file manager. */
export function recordingsVault(): string {
  return vault();
}

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function getSession(recordingId: string): Session {
  const session = sessions.get(recordingId);
  if (!session) throw new Error(`Unknown recording: ${recordingId}`);
  return session;
}

function getTrack(recordingId: string, trackId: string): TrackWriter {
  const track = getSession(recordingId).tracks.get(trackId);
  if (!track) throw new Error(`Unknown track ${trackId} on recording ${recordingId}`);
  return track;
}

async function ensureStarted(track: TrackWriter, initBytes?: Uint8Array): Promise<void> {
  if (!track.started) {
    await track.writer.start(initBytes);
    track.started = true;
  }
}

export async function startRecording(
  configs: TrackConfig[],
): Promise<{ recordingId: string; dir: string; tracks: { trackId: string; dir: string }[] }> {
  const recordingId = randomUUID();
  const dir = join(vault(), recordingId);
  const createdAt = new Date().toISOString();
  const tracks = new Map<string, TrackWriter>();
  const trackDirs: { trackId: string; dir: string }[] = [];

  for (const config of configs.filter((c) => c.enabled)) {
    const trackDir = join(dir, config.id);
    const writer = new SegmentWriter({
      dir: trackDir,
      recordingId: `${recordingId}:${config.id}`,
      createdAt,
      trackKind: trackMediaKind(config.kind),
    });
    tracks.set(config.id, { writer, started: false });
    trackDirs.push({ trackId: config.id, dir: trackDir });
  }

  sessions.set(recordingId, { dir, tracks });
  return { recordingId, dir, tracks: trackDirs };
}

export async function writeInit(
  recordingId: string,
  trackId: string,
  bytes: Uint8Array,
): Promise<void> {
  await ensureStarted(getTrack(recordingId, trackId), bytes);
}

export async function writeFragment(
  recordingId: string,
  trackId: string,
  bytes: Uint8Array,
  durationMs: number,
): Promise<number> {
  const track = getTrack(recordingId, trackId);
  await ensureStarted(track);
  try {
    await track.writer.writeFragment(bytes, durationMs);
  } catch (error) {
    if (error instanceof DiskFullError) await finalize(recordingId, 0);
    throw error;
  }
  return track.writer.sealedSegmentCount;
}

export async function pauseRecording(recordingId: string, atMs: number): Promise<void> {
  await Promise.all(
    [...getSession(recordingId).tracks.values()].map((t) =>
      t.started ? t.writer.pause(atMs) : Promise.resolve(),
    ),
  );
}

export async function resumeRecording(recordingId: string, atMs: number): Promise<void> {
  await Promise.all(
    [...getSession(recordingId).tracks.values()].map((t) =>
      t.started ? t.writer.resume(atMs) : Promise.resolve(),
    ),
  );
}

export async function stopRecording(recordingId: string, atMs: number): Promise<RecordingSummary> {
  // Idempotent: a session that was already finalized (e.g. auto-finalized on a
  // disk-full mid-recording, or a stray double-stop) must still resolve cleanly
  // so the UI's stop path always resets — never leave Stop hanging.
  if (!sessions.has(recordingId)) {
    return (
      finalizedSummaries.get(recordingId) ?? {
        recordingId,
        dir: join(vault(), recordingId),
        status: 'ready',
        segmentCount: 0,
        durationMs: 0,
      }
    );
  }
  return finalize(recordingId, atMs);
}

async function finalize(recordingId: string, atMs: number): Promise<RecordingSummary> {
  const session = getSession(recordingId);
  let segmentCount = 0;
  let durationMs = 0;
  for (const track of session.tracks.values()) {
    if (!track.started) continue;
    // One track failing to seal must not abort finalizing the others.
    try {
      const state = await track.writer.stop(atMs, 'ready');
      segmentCount += sealedSegments(state).length;
      durationMs = Math.max(durationMs, totalDurationMs(state));
    } catch {
      // writer.stop is already best-effort; ignore and keep the recording usable.
    }
  }
  sessions.delete(recordingId);
  const summary: RecordingSummary = {
    recordingId,
    dir: session.dir,
    status: 'ready',
    segmentCount,
    durationMs,
  };
  finalizedSummaries.set(recordingId, summary);
  if (finalizedSummaries.size > MAX_REMEMBERED) {
    const oldest = finalizedSummaries.keys().next().value;
    if (oldest !== undefined) finalizedSummaries.delete(oldest);
  }
  return summary;
}

/** Group per-track orphans by recording (a recording is orphaned if any track is). */
export async function listOrphans(): Promise<OrphanedRecording[]> {
  const root = vault();
  const result: OrphanedRecording[] = [];
  for (const recordingId of await subdirectories(root)) {
    const recDir = join(root, recordingId);
    const trackOrphans = await scanForOrphans(recDir);
    if (trackOrphans.length === 0) continue;
    const sealedSegmentCount = trackOrphans.reduce((n, t) => n + t.sealedSegmentCount, 0);
    // Nothing was actually recorded — don't offer to "recover" an empty session.
    if (sealedSegmentCount === 0) continue;
    const status: RecordingStatus = trackOrphans[0]?.status ?? 'recording';
    result.push({
      dir: recDir,
      recordingId,
      createdAt: trackOrphans[0]?.createdAt ?? '',
      status,
      sealedSegmentCount,
      durationMs: trackOrphans.reduce((m, t) => Math.max(m, t.durationMs), 0),
    });
  }
  return result;
}

/** Total bytes on disk for a recording (all its track segments + manifests). */
async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(path);
    } else {
      try {
        total += (await stat(path)).size;
      } catch {
        // ignore vanished files
      }
    }
  }
  return total;
}

export async function recordingSize(dir: string): Promise<number> {
  if (!isInsideVault(dir)) return 0;
  return directorySize(dir);
}

/** Delete a recording's raw segments to reclaim space (vault-scoped). */
export async function deleteRawRecording(dir: string): Promise<number> {
  if (!isInsideVault(dir)) {
    throw new Error('Refusing to delete a path outside the recordings vault');
  }
  const freed = await directorySize(dir);
  await rm(dir, { recursive: true, force: true });
  return freed;
}

export async function recover(dir: string): Promise<RecoveryResult> {
  // Security: only recover inside our own vault.
  if (!isInsideVault(dir)) {
    throw new Error('Refusing to recover a path outside the recordings vault');
  }
  let segmentCount = 0;
  let durationMs = 0;
  let outputPath = '';
  for (const trackId of await subdirectories(dir)) {
    const trackDir = join(dir, trackId);
    if (!(await fileExists(join(trackDir, 'manifest.jsonl')))) continue;
    const recovered = await recoverRecording(trackDir);
    segmentCount += recovered.segmentCount;
    durationMs = Math.max(durationMs, recovered.durationMs);
    if (!outputPath) outputPath = recovered.outputPath;
  }
  return { recordingId: basename(dir), outputPath, segmentCount, durationMs };
}
