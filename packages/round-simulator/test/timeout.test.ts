import { describe, it, expect } from "vitest";
import { RoundSimulator, makeSyntheticRound, type ActionCommand, type DecisionPolicy } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

// A policy that never moves and never engages — both teams sit on spawns/anchors.
const HOLD: DecisionPolicy = { decide: (): ActionCommand => ({ kind: "hold" }) };

describe("timeout", () => {
  it("defense wins by timeExpired when nobody plants or dies", () => {
    const result = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: HOLD, defense: HOLD },
      config: { seed: 1, roundTimeMs: 8000 },
    }).runRound(makeSyntheticRound(spatial));

    expect(result.reason).toBe("timeExpired");
    expect(result.winner).toBe("defense");
    // no plant, no kills
    expect(result.events.some((e) => e.kind === "kill")).toBe(false);
    expect(result.events.some((e) => e.kind === "planted")).toBe(false);
  });
});
