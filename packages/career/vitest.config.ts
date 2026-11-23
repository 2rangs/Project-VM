import { defineConfig } from "vitest/config";

// Own config (like match-runner): the match test wires sibling engines, so this package runs via
// `pnpm --filter @pv/career test`, not the narrowed PV-core root vitest config.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
