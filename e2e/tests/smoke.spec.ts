import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const desktopMain = join(here, '..', '..', 'apps', 'desktop', 'out', 'main', 'index.js');

/**
 * Phase 0 smoke test. Requires the desktop app to be built first
 * (`pnpm --filter @novarec/desktop build:dir`). Grows into the full
 * record → edit → export scripted smoke test in Phase 10.
 */
test('shell boots with Record, Meet, and Studio destinations', async () => {
  // Some environments export ELECTRON_RUN_AS_NODE=1, which forces Electron into
  // headless Node mode and prevents a GUI window. Strip it for the launch.
  const env = { ...process.env };
  delete env['ELECTRON_RUN_AS_NODE'];

  const app = await electron.launch({ args: [desktopMain], env });
  const window = await app.firstWindow();

  // Scope to the nav landmark — "Record" also appears as a recording button.
  const nav = window.getByRole('navigation');
  await expect(nav.getByRole('button', { name: /Record/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Meet/ })).toBeVisible();
  await expect(nav.getByRole('button', { name: /Studio/ })).toBeVisible();

  await app.close();
});
