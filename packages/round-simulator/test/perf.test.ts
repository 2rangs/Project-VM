import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

describe("fast simulation (Handoff §30-P)", () => {
  it("runs 1,000 rounds and records the elapsed time", () => {
    const N = 1000;
    const t0 = performance.now();
    let attackWins = 0;
    for (let i = 0; i < N; i++) {
      const sim = new RoundSimulator({
        spatial, weapons, abilities: NO_ABILITIES,
        policies: { attack: new ScriptedPolicy(sq, { attackSite: i % 2 === 0 ? "a-site" : "b-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
        config: { seed: 1000 + i },
      });
      const r = sim.runRound(makeSyntheticRound(spatial));
      if (r.winner === "attack") attackWins += 1;
    }
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[perf] ${N} rounds in ${ms.toFixed(0)}ms (${(ms / N).toFixed(2)} ms/round); attack win rate ${(attackWins / N).toFixed(3)}`);
    expect(ms).toBeLessThan(60000); // generous ceiling; real number is logged above
  }, 70000);
});
