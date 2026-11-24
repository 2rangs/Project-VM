import { defineConfig } from "vitest/config";

// TS tooling tests of the data-validator scripts (the pure parts: suite planning and comparison,
// the Python environment check). The Python harness has its own pytest suite in ./tests.
//   npx vitest run --config tools/data-validator/vitest.config.ts
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    root: __dirname,
    include: ["test/**/*.test.ts"],
    reporters: ["default"],
  },
});
