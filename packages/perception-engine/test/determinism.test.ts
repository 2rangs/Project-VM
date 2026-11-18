import { describe, it, expect } from "vitest";
import { PerceptionEngine, DEFAULT_PARAMS, mulberry32, type PerceptionParams } from "../src/index.js";
import { loadSpatial, zonePos, facingToward, mkPlayer, mkWorld } from "./fixture.js";

const spatial = loadSpatial();

function sceneWorld() {
  const obsPos = zonePos(spatial, "a-main");
  const enemyPos = zonePos(spatial, "a-site");
  const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos, facing: facingToward(obsPos, enemyPos) });
  const enemy = mkPlayer({ id: "enemy", teamId: "defenders", side: "defense", position: enemyPos });
  return mkWorld([observer, enemy]);
}

describe("determinism", () => {
  it("is fully deterministic by default (no RNG consumed)", () => {
    const a = new PerceptionEngine(spatial).observe(sceneWorld(), "obs");
    const b = new PerceptionEngine(spatial).observe(sceneWorld(), "obs");
    expect(a).toEqual(b);
  });

  it("same seed + same input ⇒ identical output when probabilistic detection is on", () => {
    const params: PerceptionParams = {
      ...DEFAULT_PARAMS,
      vision: { ...DEFAULT_PARAMS.vision, detectionMissProbability: 0.5, uncertainBeyondFraction: 0 },
    };
    const run = () => new PerceptionEngine(spatial, { params, rng: mulberry32(1234) }).observe(sceneWorld(), "obs");
    expect(run()).toEqual(run());
  });

  it("requires an rng when probabilistic detection is enabled", () => {
    const params: PerceptionParams = {
      ...DEFAULT_PARAMS,
      vision: { ...DEFAULT_PARAMS.vision, detectionMissProbability: 0.5 },
    };
    expect(() => new PerceptionEngine(spatial, { params })).toThrow();
  });
});
