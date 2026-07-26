import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { app } from 'electron';
import { z } from 'zod';
import { ExportHistoryEntrySchema, type ExportHistoryEntry } from '@novarec/shared';

/**
 * Export history: a small JSON ledger of produced files in userData, so the
 * Exports view can list them, rename the file on disk, or drop an entry. Capped
 * so it can't grow without bound.
 *
 * Every mutation is (a) serialized through a single promise chain — an auto-
 * export finishing concurrently with a user rename/remove must not interleave
 * their read-modify-write and lose one — and (b) written atomically (temp file
 * then rename) so a crash mid-write can't truncate the file and wipe history.
 */
const MAX_ENTRIES = 200;

// Windows reserved device names — a file named any of these (any case) is illegal.
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

let opChain: Promise<unknown> = Promise.resolve();
/** Serialize a read-modify-write so concurrent mutations can't clobber each other. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.catch(() => undefined);
  return run;
}

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
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
  await rename(tmp, file); // atomic on the same volume
}

export function addHistoryEntry(input: {
  path: string;
  name: string;
  sizeBytes: number;
  durationMs: number;
  createdAtMs: number;
}): Promise<ExportHistoryEntry> {
  return withLock(async () => {
    const entry: ExportHistoryEntry = { id: randomUUID(), ...input };
    const entries = await listHistory();
    entries.unshift(entry);
    await writeHistory(entries.slice(0, MAX_ENTRIES));
    return entry;
  });
}

/** Sanitize a user-typed name and force the original file extension. */
function sanitizeName(name: string, ext: string): string {
  let base = name.trim().replace(/[\\/:*?"<>|]/g, '');
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot); // drop any typed extension
  base = base.trim() || 'export';
  if (RESERVED.test(base)) base = `_${base}`; // avoid illegal Windows device names
  return base.slice(0, 200) + ext; // keep well under the 255/260 path limits
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** A non-colliding path for `desired` in its folder (append -2, -3, … if taken). */
async function uniquePath(desired: string, keep: string): Promise<string> {
  if (desired === keep || !(await fileExists(desired))) return desired;
  const ext = extname(desired);
  const stem = desired.slice(0, desired.length - ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!(await fileExists(candidate))) return candidate;
  }
}

export function renameHistory(id: string, newName: string): Promise<ExportHistoryEntry> {
  return withLock(async () => {
    const entries = await listHistory();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new Error('Export not found');
    const safe = sanitizeName(newName, extname(entry.path));
    // Never silently overwrite an existing file (data loss on case-insensitive or
    // POSIX renames) — disambiguate onto a free name.
    const newPath = await uniquePath(join(dirname(entry.path), safe), entry.path);
    if (newPath !== entry.path) await rename(entry.path, newPath);
    entry.path = newPath;
    entry.name = newPath.split(/[\\/]/).pop() ?? safe;
    await writeHistory(entries);
    return entry;
  });
}

export function removeHistory(id: string, deleteFile: boolean): Promise<ExportHistoryEntry[]> {
  return withLock(async () => {
    const entries = await listHistory();
    const entry = entries.find((e) => e.id === id);
    if (entry && deleteFile) await rm(entry.path, { force: true }).catch(() => undefined);
    const next = entries.filter((e) => e.id !== id);
    await writeHistory(next);
    return next;
  });
}
