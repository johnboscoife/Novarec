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
