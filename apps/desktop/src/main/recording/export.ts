import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import { buildChapterMetadata, exportRecording, finalizeTrack } from '@novarec/encoder';
import { markersToChapters } from '@novarec/overlay';
import type { ExportSettings } from '@novarec/shared';
import { ffmpegBinaryPath } from '../ffmpeg-path.js';
import { loadAppSettings } from '../app-settings-store.js';
import { addHistoryEntry } from '../export-history-store.js';
import { deleteRawRecording, isInsideVault, readMarkers } from './session.js';

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

/**
 * Exports run STRICTLY one at a time, enforced here in main.
 *
 * An export rewrites `track.mp4` inside the recording directory (finalize) and
 * then reads it for the whole encode. Two overlapping exports of the same
 * recording therefore have one re-finalizing the very file the other is still
 * reading, and the first dies partway through with a decode error. The renderer
 * keeps its own queue for the UI, but that is a convenience, not a guarantee —
 * a reloaded renderer, a second window, or any other caller of `export:run`
 * would sail straight past it. Main owns the invariant.
 */
let exportChain: Promise<unknown> = Promise.resolve();

export function runExport(
  recordingDir: string,
  settings: ExportSettings,
  onProgress?: (elapsedMs: number, totalMs: number) => void,
): Promise<{ outputPath: string; durationMs: number }> {
  const run = exportChain.then(
    () => doExport(recordingDir, settings, onProgress),
    () => doExport(recordingDir, settings, onProgress), // a failed export must not block the queue
  );
  // Swallow rejection on the chain only — callers still see the real result.
  exportChain = run.catch(() => undefined);
  return run;
}

async function doExport(
  recordingDir: string,
  settings: ExportSettings,
  onProgress?: (elapsedMs: number, totalMs: number) => void,
): Promise<{ outputPath: string; durationMs: number }> {
  // Security: only export recordings inside our own vault.
  if (!isInsideVault(recordingDir)) {
    throw new Error('Refusing to export a path outside the recordings vault');
  }

  const inputs: { path: string; role: 'screen' | 'camera' | 'audio' }[] = [];
  let durationMs = 0;
  for (const trackId of await trackDirs(recordingDir)) {
    const finalized = await finalizeTrack(join(recordingDir, trackId));
    if (finalized) {
      // `recording` is the single-file mode's one muxed track: it carries the
      // video, so it must not be treated as an audio-only input.
      const role =
        trackId === 'camera'
          ? 'camera'
          : trackId === 'screen' || trackId === 'recording'
            ? 'screen'
            : 'audio';
      inputs.push({ path: finalized.path, role });
      durationMs = Math.max(durationMs, finalized.durationMs);
    }
  }
  if (inputs.length === 0) throw new Error('Nothing to export — no sealed segments found');

  // Markers dropped during the take become real chapters in the exported file,
  // so a bookmark made mid-recording is still useful in a player afterwards.
  const chapters = markersToChapters(await readMarkers(recordingDir), durationMs);
  const chapterMetadata = buildChapterMetadata(chapters, durationMs);
  const chaptersPath = chapterMetadata ? join(recordingDir, 'chapters.ffmeta') : null;
  if (chaptersPath && chapterMetadata) await writeFile(chaptersPath, chapterMetadata, 'utf8');

  const folder = await destinationFolder();
  const outputPath = await uniqueOutputPath(folder, settings.container);
  // Encode to a temp sibling (same extension so FFmpeg picks the right muxer),
  // then atomically rename into place only on success. A failed/disk-full/killed
  // encode therefore never leaves a corrupt half-file at the deliverable path.
  const tempPath = join(folder, `.novarec-export-${randomUUID()}.${settings.container}`);
  try {
    await exportRecording({
      ffmpegPath: ffmpegBinaryPath(),
      inputs,
      settings,
      outputPath: tempPath,
      ...(chaptersPath ? { chaptersPath } : {}),
      ...(onProgress ? { onProgress: (elapsedMs) => onProgress(elapsedMs, durationMs) } : {}),
    });
    await rename(tempPath, outputPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

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

/**
 * Save a still frame from the live capture. It goes to the same folder as
 * exports, because that is where the user already looks for what NovaRec
 * produced — a snapshot buried in the app data folder is a snapshot lost.
 */
export async function saveSnapshot(bytes: Uint8Array): Promise<{ path: string }> {
  const folder = await destinationFolder();
  const path = await uniqueOutputPath(folder, 'png');
  await writeFile(path, bytes);
  return { path };
}
