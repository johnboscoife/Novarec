import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Electron cold start (a ~225 MB binary) measured 25s on a loaded machine, so
  // 30s made this a coin flip. The test itself finishes in well under a second.
  timeout: 90_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? 'github' : 'list',
});
