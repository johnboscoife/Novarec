import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { app } from 'electron';
import { exportRecording, finalizeTrack } from '@novarec/encoder';
import type { ExportSettings } from '@novarec/shared';
import { ffmpegBinaryPath } from '../ffmpeg-path.js';
import { loadAppSettings } from '../app-settings-store.js';
import { addHistoryEntry } from '../export-history-store.js';
import { deleteRawRecording, recordingsVault } from './session.js';

/**
 * Export a finished recording: finalize each track (concat its sealed fMP4
 * fragments) then run FFmpeg with the chosen settings into one deliverable —
 * written to the user's export folder (default <Videos>/NovaRec), recorded in
 * export history, and optionally followed by deleting the raw segments.
 */
async function trackDirs(recordingDir: string): Promise<string[]> {
  try {
    const entries = await readdir(recordingDir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function destinationFolder(): Promise<string> {
  const settings = await loadAppSettings();
  const folder = settings.exportFolder ?? join(app.getPath('videos'), 'NovaRec');
  await mkdir(folder, { recursive: true });
  return folder;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timestampName(container: string): string {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `NovaRec-${stamp}.${container}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A collision-free path in the destination folder for the generated name. */
async function uniqueOutputPath(folder: string, container: string): Promise<string> {
  const base = timestampName(container);
  let candidate = join(folder, base);
  let n = 2;
  while (await fileExists(candidate)) {
    candidate = join(folder, base.replace(`.${container}`, `-${n}.${container}`));
    n += 1;
  }
  return candidate;
}

export async function runExport(
  recordingDir: string,
  settings: ExportSettings,
  onProgress?: (elapsedMs: number, totalMs: number) => void,
): Promise<{ outputPath: string; durationMs: number }> {
  // Security: only export recordings inside our own vault.
  if (!resolve(recordingDir).startsWith(resolve(recordingsVault()))) {
    throw new Error('Refusing to export a path outside the recordings vault');
  }

  const inputs: { path: string; role: 'screen' | 'camera' | 'audio' }[] = [];
  let durationMs = 0;
  for (const trackId of await trackDirs(recordingDir)) {
    const finalized = await finalizeTrack(join(recordingDir, trackId));
    if (finalized) {
      const role = trackId === 'camera' ? 'camera' : trackId === 'screen' ? 'screen' : 'audio';
      inputs.push({ path: finalized.path, role });
      durationMs = Math.max(durationMs, finalized.durationMs);
    }
  }
  if (inputs.length === 0) throw new Error('Nothing to export — no sealed segments found');

  const folder = await destinationFolder();
  const outputPath = await uniqueOutputPath(folder, settings.container);
  await exportRecording({
    ffmpegPath: ffmpegBinaryPath(),
    inputs,
    settings,
    outputPath,
    ...(onProgress ? { onProgress: (elapsedMs) => onProgress(elapsedMs, durationMs) } : {}),
  });

  const sizeBytes = (await stat(outputPath).catch(() => ({ size: 0 }))).size;
  await addHistoryEntry({
    path: outputPath,
    name: outputPath.split(/[\\/]/).pop() ?? outputPath,
    sizeBytes,
    durationMs,
    createdAtMs: Date.now(),
  });

  // Optional auto-cleanup of the raw segments (explicit opt-in in Settings).
  const settingsNow = await loadAppSettings();
  if (settingsNow.deleteRawAfterExport) {
    await deleteRawRecording(recordingDir).catch(() => undefined);
  }

  return { outputPath, durationMs };
}
