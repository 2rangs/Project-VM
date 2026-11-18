import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function sim(seed: number, attackSite = "a-site") {
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    config: { seed },
  });
}

describe("5v5 round loop", () => {
  it("runs a full round to a terminal reason", () => {
    const result = sim(1).runRound(makeSyntheticRound(spatial));
    expect(["attack", "defense"]).toContain(result.winner);
    expect(["elimination", "spikeDetonation", "spikeDefused", "timeExpired"]).toContain(result.reason);
    expect(result.events[0].kind).toBe("roundStart");
    expect(result.events[result.events.length - 1].kind).toBe("roundEnd");
    expect(result.endedAtTick).toBeGreaterThan(0);
  });

  it("produces kills and an engagement when the teams meet", () => {
    const result = sim(3).runRound(makeSyntheticRound(spatial));
    expect(result.events.some((e) => e.kind === "engage")).toBe(true);
    expect(result.events.some((e) => e.kind === "kill")).toBe(true);
  });

  it("different seeds can produce different rounds", () => {
    const a = sim(1).runRound(makeSyntheticRound(spatial));
    const b = sim(99).runRound(makeSyntheticRound(spatial));
    expect(JSON.stringify(a.events)).not.toEqual(JSON.stringify(b.events));
  });
});
