import { defineConfig } from 'vitest/config';

// Unit tests live beside source in packages/* and apps/*. The Playwright
// end-to-end suite under e2e/ is run by its own runner (`pnpm test:e2e`) and
// must be excluded here — Playwright's test() cannot run under Vitest.
export default defineConfig({
  test: {
    include: ['packages/**/*.{test,spec}.ts', 'apps/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', 'e2e/**'],
  },
});
