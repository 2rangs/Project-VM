import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, loadAbilities, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();
const abilities = loadAbilities();

describe("utility is actually deployed in a round", () => {
  it("attackers with a loadout and useUtility fire abilities (charges consumed, effects logged)", () => {
    const result = new RoundSimulator({
      spatial, weapons, abilities,
      policies: {
        attack: new ScriptedPolicy(sq, { attackSite: "a-site", useUtility: true }),
        defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
      },
      config: { seed: 5 },
    }).runRound(makeSyntheticRound(spatial, { withAbilities: true }));

    const used = result.events.filter((e) => e.kind === "abilityUsed");
    expect(used.length).toBeGreaterThan(0);
    // the deployed set includes at least a smoke and one other utility type
    const ids = new Set(used.map((e) => e.detail));
    expect(ids.has("omen:Ability2")).toBe(true);
  });

  it("is deterministic with utility enabled", () => {
    const run = () =>
      new RoundSimulator({
        spatial, weapons, abilities,
        policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site", useUtility: true }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
        config: { seed: 9 },
      }).runRound(makeSyntheticRound(spatial, { withAbilities: true }));
    expect(run()).toEqual(run());
  });
});
