import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { ExportHistoryEntrySchema, type ExportHistoryEntry } from '@novarec/shared';

/**
 * Export history: a small JSON ledger of produced files in userData, so the
 * Exports view can list them, rename the file on disk, or drop an entry. Capped
 * so it can't grow without bound.
 */
const MAX_ENTRIES = 200;

function historyFile(): string {
  return join(app.getPath('userData'), 'export-history.json');
}

export async function listHistory(): Promise<ExportHistoryEntry[]> {
  try {
    const raw: unknown = JSON.parse(await readFile(historyFile(), 'utf8'));
    const parsed = z.array(ExportHistoryEntrySchema).safeParse(raw);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

async function writeHistory(entries: ExportHistoryEntry[]): Promise<void> {
  const file = historyFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(entries, null, 2), 'utf8');
}

export async function addHistoryEntry(input: {
  path: string;
  name: string;
  sizeBytes: number;
  durationMs: number;
  createdAtMs: number;
}): Promise<ExportHistoryEntry> {
  const entry: ExportHistoryEntry = { id: randomUUID(), ...input };
  const entries = await listHistory();
  entries.unshift(entry);
  await writeHistory(entries.slice(0, MAX_ENTRIES));
  return entry;
}

/** Sanitize a user-typed name and force the original file extension. */
function sanitizeName(name: string, ext: string): string {
  let base = name.trim().replace(/[\\/:*?"<>|]/g, '');
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot); // drop any typed extension
  base = base.trim() || 'export';
  return base + ext;
}

export async function renameHistory(id: string, newName: string): Promise<ExportHistoryEntry> {
  const entries = await listHistory();
  const entry = entries.find((e) => e.id === id);
  if (!entry) throw new Error('Export not found');
  const safe = sanitizeName(newName, extname(entry.path));
  const newPath = join(dirname(entry.path), safe);
  if (newPath !== entry.path) await rename(entry.path, newPath);
  entry.path = newPath;
  entry.name = safe;
  await writeHistory(entries);
  return entry;
}

export async function removeHistory(
  id: string,
  deleteFile: boolean,
): Promise<ExportHistoryEntry[]> {
  const entries = await listHistory();
  const entry = entries.find((e) => e.id === id);
  if (entry && deleteFile) await rm(entry.path, { force: true }).catch(() => undefined);
  const next = entries.filter((e) => e.id !== id);
  await writeHistory(next);
  return next;
}
