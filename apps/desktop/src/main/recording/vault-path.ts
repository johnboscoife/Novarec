import { resolve, sep } from 'node:path';

/**
 * True if `dir` is STRICTLY inside one of `roots` — never a root itself.
 *
 * Pure (no Electron) so the rule can be tested directly. Separator-anchored, so
 * a sibling like `<vault>-backup` can't pass a bare prefix check.
 */
export function isStrictlyInside(dir: string, roots: readonly string[]): boolean {
  const target = resolve(dir);
  return roots.some((root) => {
    const base = resolve(root);
    // A filesystem root already ends in a separator (`/`, `C:\`).
    const prefix = base.endsWith(sep) ? base : base + sep;
    return target !== base && target.startsWith(prefix);
  });
}

/** How many past storage folders are remembered. */
const MAX_PREVIOUS_LOCATIONS = 20;

/**
 * The past-storage-folder list after a settings save. When the storage folder
 * changes, the one being left joins the list — the recordings made there stay
 * there. Built from what was STORED, not what the renderer sent, so a save can
 * never forget a folder. The current folder is never in its own history.
 */
export function nextPreviousLocations(
  stored: { storageLocation: string | null; previousStorageLocations: readonly string[] },
  nextLocation: string | null,
): string[] {
  const candidates = [...stored.previousStorageLocations];
  if (stored.storageLocation !== null) candidates.unshift(stored.storageLocation);
  const seen = new Set<string>();
  if (nextLocation !== null) seen.add(resolve(nextLocation));
  const result: string[] = [];
  for (const location of candidates) {
    const key = resolve(location);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(location);
  }
  return result.slice(0, MAX_PREVIOUS_LOCATIONS);
}
