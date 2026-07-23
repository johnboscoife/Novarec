import { randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
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

function vault(): string {
  return join(app.getPath('userData'), 'recordings');
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
  return sealedSegments(track.writer.state).length;
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
  return finalize(recordingId, atMs);
}

async function finalize(recordingId: string, atMs: number): Promise<RecordingSummary> {
  const session = getSession(recordingId);
  let segmentCount = 0;
  let durationMs = 0;
  for (const track of session.tracks.values()) {
    if (!track.started) continue;
    const state = await track.writer.stop(atMs, 'ready');
    segmentCount += sealedSegments(state).length;
    durationMs = Math.max(durationMs, totalDurationMs(state));
  }
  sessions.delete(recordingId);
  return { recordingId, dir: session.dir, status: 'ready', segmentCount, durationMs };
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

export async function recover(dir: string): Promise<RecoveryResult> {
  // Security: only recover inside our own vault.
  if (!resolve(dir).startsWith(resolve(vault()))) {
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
