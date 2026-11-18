import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(seed: number) {
  const s = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed },
  });
  return s.runRound(makeSyntheticRound(spatial));
}

describe("determinism (DECISION-010)", () => {
  it("identical initial state + seed ⇒ byte-identical event log", () => {
    expect(JSON.stringify(run(42))).toEqual(JSON.stringify(run(42)));
  });

  it("the full result object is deeply equal across runs with the same seed", () => {
    expect(run(7)).toEqual(run(7));
  });
});
