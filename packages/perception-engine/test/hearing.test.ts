import { describe, it, expect } from "vitest";
import { PerceptionEngine, collectSoundSources, DEFAULT_PARAMS } from "../src/index.js";
import { loadSpatial, zonePos, mkPlayer, mkWorld, gunfireEvent } from "./fixture.js";

const spatial = loadSpatial();

describe("hearing", () => {
  it("hears a running enemy in the same zone but not a walking one", () => {
    const obsPos = zonePos(spatial, "a-site");
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos });
    const runner = mkPlayer({ id: "run", teamId: "defenders", side: "defense", position: obsPos, behaviorState: "running" });
    const walker = mkPlayer({ id: "walk", teamId: "defenders", side: "defense", position: obsPos, behaviorState: "walking" });

    const engine = new PerceptionEngine(spatial);
    const obs = engine.observe(mkWorld([observer, runner, walker]), "obs")!;
    const footsteps = obs.audibleEvents.filter((s) => s.kind === "footstep");
    // exactly one footstep source (the runner); the walker is silent
    expect(footsteps.length).toBe(1);
  });

  it("walking/still players produce no footstep sources", () => {
    const pos = zonePos(spatial, "b-site");
    const world = mkWorld([
      mkPlayer({ id: "a", position: pos, behaviorState: "walking" }),
      mkPlayer({ id: "b", position: pos, behaviorState: "still" }),
    ]);
    const sources = collectSoundSources(world, DEFAULT_PARAMS);
    expect(sources.filter((s) => s.kind === "footstep").length).toBe(0);
  });

  it("propagates loud gunfire to an adjacent zone and localises to the zone, not exact coords", () => {
    const obsPos = zonePos(spatial, "b-site");
    const shooterPos = zonePos(spatial, "b-main"); // b-main <-> b-site sound link
    const observer = mkPlayer({ id: "obs", teamId: "attackers", position: obsPos });
    const shooter = mkPlayer({ id: "sh", teamId: "defenders", side: "defense", position: { x: shooterPos.x + 37, y: shooterPos.y - 21, z: shooterPos.z } });
    const world = mkWorld([observer, shooter], { tick: 10, events: [gunfireEvent(10, "sh", "obs")] });

    const engine = new PerceptionEngine(spatial);
    const obs = engine.observe(world, "obs")!;
    const gun = obs.audibleEvents.find((s) => s.kind === "gunfire");
    expect(gun).toBeDefined();
    // approxPosition is the SOURCE ZONE center (b-main), never the shooter's exact coords
    const bMain = zonePos(spatial, "b-main");
    expect(gun!.approxPosition.x).toBeCloseTo(bMain.x, 3);
    expect(gun!.approxPosition.y).toBeCloseTo(bMain.y, 3);
    expect(gun!.approxPosition.x).not.toBeCloseTo(shooter.position.x, 3);
    expect(gun!.confidence).toBeGreaterThan(0);
    expect(gun!.confidence).toBeLessThanOrEqual(1);
  });
});
