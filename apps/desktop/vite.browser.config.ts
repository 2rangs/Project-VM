// Temporary: serve the renderer alone in a plain browser (no Electron) for UI checks.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = (p: string) => path.resolve(here, '../../packages', p, 'src/index.ts');
export default defineConfig({
  root: path.resolve(here, 'src/renderer'),
  resolve: { alias: { '@pv/replay-engine': pkg('replay-engine'), '@pv/replay-viewer': path.resolve(here, '../replay-viewer/src/lib/index.ts'), '@pv/round-simulator': pkg('round-simulator'), '@pv/spatial-engine': pkg('spatial-engine'), '@pv/combat-engine': pkg('combat-engine'), '@pv/perception-engine': pkg('perception-engine'), '@pv/ability-engine': pkg('ability-engine'), '@pv/shared-types': pkg('shared-types') }, dedupe: ['react', 'react-dom', 'pixi.js'] },
  plugins: [react()],
  server: { port: 5199, fs: { allow: [path.resolve(here, '../..')] } },
});
