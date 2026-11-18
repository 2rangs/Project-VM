import { defineConfig } from "vitest/config";

// Own config: match-runner wires sibling engines (round-simulator → spatial/combat), so it
// runs via `pnpm -r test`, not the narrowed PV-core root vitest config (INTEGRATION_PLAN F5).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
  },
});
