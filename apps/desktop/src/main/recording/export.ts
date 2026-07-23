import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { exportRecording, finalizeTrack } from '@novarec/encoder';
import type { ExportSettings } from '@novarec/shared';
import { ffmpegBinaryPath } from '../ffmpeg-path.js';

/**
 * Export a finished recording: finalize each track (concat its sealed fMP4
 * fragments) then run FFmpeg with the chosen settings into one deliverable.
 */
function vault(): string {
  return join(app.getPath('userData'), 'recordings');
}

async function trackDirs(recordingDir: string): Promise<string[]> {
  try {
    const entries = await readdir(recordingDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function runExport(
  recordingDir: string,
  settings: ExportSettings,
  onProgress?: (elapsedMs: number, totalMs: number) => void,
): Promise<{ outputPath: string; durationMs: number }> {
  // Security: only export recordings inside our own vault.
  if (!resolve(recordingDir).startsWith(resolve(vault()))) {
    throw new Error('Refusing to export a path outside the recordings vault');
  }

  const inputs: string[] = [];
  let durationMs = 0;
  for (const trackId of await trackDirs(recordingDir)) {
    const finalized = await finalizeTrack(join(recordingDir, trackId));
    if (finalized) {
      inputs.push(finalized.path);
      durationMs = Math.max(durationMs, finalized.durationMs);
    }
  }
  if (inputs.length === 0) throw new Error('Nothing to export — no sealed segments found');

  const outputPath = join(recordingDir, `export.${settings.container}`);
  await exportRecording({
    ffmpegPath: ffmpegBinaryPath(),
    inputs,
    settings,
    outputPath,
    ...(onProgress ? { onProgress: (elapsedMs) => onProgress(elapsedMs, durationMs) } : {}),
  });
  return { outputPath, durationMs };
}
