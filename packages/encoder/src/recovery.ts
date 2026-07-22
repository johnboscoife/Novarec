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
    if (!(await disk.exists(manifestPath))) continue;

    const state = reduceEvents(parseEvents(await disk.readText(manifestPath)));
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
export async function recoverRecording(
  dir: string,
  disk: DiskIO = nodeDisk,
): Promise<RecoveryResult> {
  const manifestPath = join(dir, MANIFEST_FILENAME);
  const state = reduceEvents(parseEvents(await disk.readText(manifestPath)));
  const sealed = sealedSegments(state);

  const parts: Buffer[] = [];
  if (state.initSegment) parts.push(await disk.readFile(join(dir, state.initSegment)));
  for (const seg of sealed) parts.push(await disk.readFile(join(dir, seg.path)));

  const outputPath = join(dir, 'recovered.mp4');
  await disk.writeAndSync(outputPath, Buffer.concat(parts));

  const durationMs = totalDurationMs(state);
  await disk.appendAndSync(
    manifestPath,
    encoder.encode(serializeEvent({ type: 'stop', atMs: durationMs, status: 'recovered' })),
  );

  return { recordingId: state.recordingId, outputPath, segmentCount: sealed.length, durationMs };
}
