import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Standalone app: resolve @pv/replay-engine to its TS source (no build step).
// Root monorepo wiring is PV-3's; this app stands alone.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@pv/replay-engine': path.resolve(here, '../../packages/replay-engine/src/index.ts'),
    },
  },
  server: { port: 5178 },
});
