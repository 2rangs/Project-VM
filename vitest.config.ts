import { defineConfig } from "vitest/config";

// Single root Vitest config. Workspace packages (@pv/*) resolve through pnpm
// symlinks to each package's `exports` entry (its src/index.ts), and Vitest
// transforms the TypeScript on the fly — so there is no build step before tests.
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["packages/*/test/**/*.test.ts"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/index.ts"],
    },
  },
});
