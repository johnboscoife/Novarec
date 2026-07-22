import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Internal workspace packages ship TypeScript source (no build step), so they
// must be BUNDLED into the main/preload output rather than externalized —
// otherwise the packaged app would `require()` a `.ts` file at runtime.
const INTERNAL_PACKAGES = ['@novarec/shared', '@novarec/ui'];

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
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
    plugins: [react(), tailwindcss()],
  },
});
