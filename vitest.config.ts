import { defineConfig } from "vitest/config";

// Root Vitest runs the PV-core (simulation/decision) packages, which share this config and
// the vitest runner. Sibling-branch packages (spatial/combat/perception/ability/round-
// simulator/economy/replay) bring their own test runners (vitest or node:test) and are run
// via `pnpm -r test` — a single root vitest cannot run node:test files (see
// docs/archive/INTEGRATION_PLAN.md F5). Hence the explicit per-package include below.
const PV_CORE = [
  "simulation-core",
  "game-rules",
  "world-state",
  "decision-engine",
  "action-generator",
  "decision-debugger",
  "team-engine",
  "outcome-predictor",
  "integration-adapters",
];

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: PV_CORE.map((p) => `packages/${p}/test/**/*.test.ts`),
    reporters: ["default"],
  },
});
