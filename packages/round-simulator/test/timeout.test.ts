import { describe, it, expect } from "vitest";
import { RoundSimulator, makeSyntheticRound, type DecisionPolicy, type PolicyDecision, type PolicyView } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

// A team policy where everyone holds — both teams sit on spawns/anchors.
const HOLD: DecisionPolicy = {
  decide(view: PolicyView): PolicyDecision {
    return { strategy: "default", roles: [], commands: view.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" })) };
  },
};

describe("timeout", () => {
  it("defense wins by timeExpired when nobody plants or dies", () => {
    const result = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: HOLD, defense: HOLD },
      config: { seed: 1, roundTimeMs: 8000 },
    }).runRound(makeSyntheticRound(spatial));

    expect(result.reason).toBe("timeExpired");
    expect(result.winner).toBe("defense");
    expect(result.events.some((e) => e.kind === "kill")).toBe(false);
    expect(result.events.some((e) => e.kind === "planted")).toBe(false);
  });
});
