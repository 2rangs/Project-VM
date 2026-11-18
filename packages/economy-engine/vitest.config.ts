import { defineConfig } from "vitest/config";

// Local config so this package's `vitest run` does not inherit the monorepo root config
// (which scopes to PV-core packages). Added during integration wiring.
export default defineConfig({
  test: {
    root: __dirname,
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
