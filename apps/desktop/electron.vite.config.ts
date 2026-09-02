import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Internal workspace packages ship TypeScript SOURCE (no build step), so they
 * must be BUNDLED into the main/preload output rather than externalized —
 * otherwise the packaged app `require()`s a `.ts` file from inside app.asar and
 * dies on launch with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
 *
 * Derived from package.json rather than hand-listed: this list used to be a
 * literal, and adding a workspace dependency without remembering to add it here
 * shipped exactly that crash. Anything declared `workspace:*` is internal by
 * definition, so it can't be forgotten now.
 */
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
};
const INTERNAL_PACKAGES = Object.entries(packageJson.dependencies ?? {})
  .filter(([, version]) => version.startsWith('workspace:'))
  .map(([name]) => name);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: INTERNAL_PACKAGES })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
        },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
