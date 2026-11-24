// A3 PP-03 rule: a defuse let go past the half-defuse checkpoint (3.5 s of 7 s) resumes from it;
// before it, from 0 (game-rules spike.ts defuseHalfwayMs). SimConfig.defuseHalfwayMs.
import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const sim = (defuseHalfwayMs?: number) => new RoundSimulator({
  spatial, weapons: loadWeapons(), abilities: NO_ABILITIES,
  policies: { attack: new ScriptedPolicy(sq), defense: new ScriptedPolicy(sq) },
  config: { seed: 1, ...(defuseHalfwayMs !== undefined ? { defuseHalfwayMs } : {}) },
});
const keep = (s: RoundSimulator, progress: number) => (s as unknown as { defuseCheckpoint(p: number): number }).defuseCheckpoint(progress);

describe("half-defuse checkpoint", () => {
  it("defused 3.6 s then let go → resumes at 3.5 s (finishes 3.5 s later); 3.4 s → from 0", () => {
    const s = sim(3500);
    expect(keep(s, 3600)).toBe(3500);
    expect(7000 - keep(s, 3600)).toBe(3500);
    expect(keep(s, 3400)).toBe(0);
  });
  it("off (the pre-A3 engine): progress always resets", () => {
    expect(keep(sim(), 6900)).toBe(0);
  });
});
