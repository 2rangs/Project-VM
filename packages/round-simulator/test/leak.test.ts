import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, type ActionCommand, type DecisionContext, type DecisionPolicy } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

describe("policy cannot access WorldState (DECISION-004)", () => {
  it("the context handed to a policy has no omniscient world fields", () => {
    const seenKeys = new Set<string>();
    let sawObservation = false;

    const spy: DecisionPolicy = {
      decide(ctx: DecisionContext): ActionCommand {
        for (const k of Object.keys(ctx)) seenKeys.add(k);
        if (ctx.observation) sawObservation = true;
        // runtime assertion: no ground-truth containers reachable from the context
        const c = ctx as unknown as Record<string, unknown>;
        expect(c).not.toHaveProperty("players");
        expect(c).not.toHaveProperty("spike");
        expect(c).not.toHaveProperty("world");
        expect(c).not.toHaveProperty("enemies");
        return { kind: "hold" };
      },
    };

    new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: spy, defense: new ScriptedPolicy({ defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
      config: { seed: 1, roundTimeMs: 5000 },
    }).runRound(makeSyntheticRound(spatial));

    expect(sawObservation).toBe(true);
    // the context exposes only self + round + observation + abilities, never enemy truth
    expect([...seenKeys].sort()).toEqual(
      ["abilities", "hasSpike", "observation", "round", "selfAlive", "selfId", "selfPosition", "selfZoneId", "side", "teamId"].sort(),
    );
  });
});
