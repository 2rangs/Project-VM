import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const pkg = (p: string) => path.resolve(here, '../../packages', p, 'src/index.ts');
// Every workspace package, so the engine host bundle (src/engine/host.ts → @pv/match-runner and
// all it pulls in) resolves from source without relying on pnpm's node_modules symlinks.
const enginePackages = Object.fromEntries(
  readdirSync(path.join(repo, 'packages'))
    .filter((d) => existsSync(pkg(d)))
    .map((d) => [`@pv/${d}`, pkg(d)]),
);
const alias = {
  ...enginePackages,
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

/**
 * The engine packages locate their JSON through `import.meta.url` (next to the package source or
 * at the repo root). Bundled, every such URL would point at the bundle file, so each
 * `import.meta.url` under packages/** becomes `pvSourceUrl("<repo-relative source path>")`, which
 * resolves inside the engine data root at run time (src/engine/root.ts): the repository in
 * development, <resources>/engine in the packaged app.
 */
function pvEngineDataPaths(): Plugin {
  const packagesDir = path.join(repo, 'packages') + path.sep;
  const rootModule = path.resolve(here, 'src/engine/root.ts');
  return {
    name: 'pv-engine-data-paths',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!file.startsWith(packagesDir) || !code.includes('import.meta.url')) return null;
      const rel = path.relative(repo, file).split(path.sep).join('/');
      return {
        code: `import { pvSourceUrl as __pvSourceUrl } from ${JSON.stringify(rootModule)};\n`
          + code.replaceAll('import.meta.url', `__pvSourceUrl(${JSON.stringify(rel)})`),
        map: null,
      };
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    plugins: [pvEngineDataPaths()],
    build: {
      rollupOptions: {
        // Extra entries Electron utilityProcess.fork()s, so simulation runs off the UI thread
        // (DECISION-007): engine-host is the whole match engine in one self-contained file
        // (src/engine/host.ts); sim-worker is the small round-simulator fallback.
        input: {
          index: path.resolve(here, 'src/main/index.ts'),
          'engine-host': path.resolve(here, 'src/engine/host.ts'),
          'sim-worker': path.resolve(here, 'src/main/sim-worker.ts'),
        },
        // optional ONNX runtime of the economy model: never bundled, loaded only if installed
        external: ['onnxruntime-node'],
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
