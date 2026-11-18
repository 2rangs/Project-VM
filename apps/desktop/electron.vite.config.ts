import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const alias = {
  '@pv/replay-engine': path.resolve(here, '../../packages/replay-engine/src/index.ts'),
  '@pv/replay-viewer': path.resolve(here, '../replay-viewer/src/lib/index.ts'),
};

// Bundle the @pv workspace sources (they are TS aliases, not published deps).
const bundlePv = { exclude: ['@pv/replay-engine', '@pv/replay-viewer'] };

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        // sim-worker is a second entry: Electron utilityProcess.fork()s it so the
        // simulation runs off the UI thread (DECISION-007).
        input: {
          index: path.resolve(here, 'src/main/index.ts'),
          'sim-worker': path.resolve(here, 'src/main/sim-worker.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
    optimizeDeps: bundlePv,
  },
  preload: {
    resolve: { alias },
    build: { rollupOptions: { input: path.resolve(here, 'src/preload/index.ts') } },
  },
  renderer: {
    root: path.resolve(here, 'src/renderer'),
    resolve: { alias },
    plugins: [react()],
    build: {
      rollupOptions: { input: path.resolve(here, 'src/renderer/index.html') },
    },
    server: { port: 5190 },
  },
});
