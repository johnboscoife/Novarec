import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import {
  DiskFullError,
  SegmentWriter,
  recoverRecording,
  scanForOrphans,
  sealedSegments,
  totalDurationMs,
} from '@novarec/encoder';
import type { OrphanedRecording, RecordingSummary, RecoveryResult } from '@novarec/shared';

/**
 * Bridges the renderer's encoder stream to the durable, unit-tested
 * SegmentWriter. The renderer sends the init segment then fragments; main
 * persists them. On disk-full it finalizes gracefully so sealed segments are
 * never lost.
 */
interface Session {
  writer: SegmentWriter;
  started: boolean;
}

const sessions = new Map<string, Session>();

function vault(): string {
  return join(app.getPath('userData'), 'recordings');
}

function getSession(recordingId: string): Session {
  const session = sessions.get(recordingId);
  if (!session) throw new Error(`Unknown recording: ${recordingId}`);
  return session;
}

async function ensureStarted(session: Session, initBytes?: Uint8Array): Promise<void> {
  if (!session.started) {
    await session.writer.start(initBytes);
    session.started = true;
  }
}

export async function startRecording(
  trackKind: 'video' | 'audio',
): Promise<{ recordingId: string; dir: string }> {
  const recordingId = randomUUID();
  const dir = join(vault(), recordingId);
  const writer = new SegmentWriter({
    dir,
    recordingId,
    createdAt: new Date().toISOString(),
    trackKind,
  });
  sessions.set(recordingId, { writer, started: false });
  return { recordingId, dir };
}

export async function writeInit(recordingId: string, bytes: Uint8Array): Promise<void> {
  await ensureStarted(getSession(recordingId), bytes);
}

export async function writeFragment(
  recordingId: string,
  bytes: Uint8Array,
  durationMs: number,
): Promise<number> {
  const session = getSession(recordingId);
  await ensureStarted(session);
  try {
    await session.writer.writeFragment(bytes, durationMs);
  } catch (error) {
    if (error instanceof DiskFullError) await finalize(recordingId, 0);
    throw error;
  }
  return sealedSegments(session.writer.state).length;
}

export async function pauseRecording(recordingId: string, atMs: number): Promise<void> {
  await getSession(recordingId).writer.pause(atMs);
}

export async function resumeRecording(recordingId: string, atMs: number): Promise<void> {
  await getSession(recordingId).writer.resume(atMs);
}

export async function stopRecording(recordingId: string, atMs: number): Promise<RecordingSummary> {
  return finalize(recordingId, atMs);
}

async function finalize(recordingId: string, atMs: number): Promise<RecordingSummary> {
  const session = getSession(recordingId);
  const state = await session.writer.stop(atMs, 'ready');
  sessions.delete(recordingId);
  return {
    recordingId,
    dir: join(vault(), recordingId),
    status: state.status,
    segmentCount: sealedSegments(state).length,
    durationMs: totalDurationMs(state),
  };
}

export function listOrphans(): Promise<OrphanedRecording[]> {
  return scanForOrphans(vault());
}

export function recover(dir: string): Promise<RecoveryResult> {
  // Security: only recover recordings inside our own vault.
  const root = resolve(vault());
  if (!resolve(dir).startsWith(root)) {
    return Promise.reject(new Error('Refusing to recover a path outside the recordings vault'));
  }
  return recoverRecording(dir);
}
