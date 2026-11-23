import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (p: string) => path.resolve(here, '../../packages', p, 'src/index.ts');
const alias = {
  '@pv/replay-engine': pkg('replay-engine'),
  '@pv/replay-viewer': path.resolve(here, '../replay-viewer/src/lib/index.ts'),
  // PV-4 round simulator + its engines + PV-core shared-types, all pure-TS source
  // bundled into the Electron worker so the real match runs in a separate process.
  '@pv/round-simulator': pkg('round-simulator'),
  '@pv/spatial-engine': pkg('spatial-engine'),
  '@pv/combat-engine': pkg('combat-engine'),
  '@pv/perception-engine': pkg('perception-engine'),
  '@pv/ability-engine': pkg('ability-engine'),
  '@pv/shared-types': pkg('shared-types'),
};

// Bundle the @pv workspace sources (they are TS aliases, not published deps).
const bundlePv = { exclude: Object.keys(alias) };

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
    // The shared ReplayViewer source lives in ../replay-viewer and imports react /
    // pixi.js; resolve those from THIS app's node_modules so the build needs no
    // install in apps/replay-viewer and the renderer never bundles two Reacts.
    resolve: { alias, dedupe: ['react', 'react-dom', 'pixi.js'] },
    plugins: [react()],
    build: {
      rollupOptions: { input: path.resolve(here, 'src/renderer/index.html') },
    },
    server: { port: 5190 },
  },
});
