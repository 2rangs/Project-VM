import { describe, it, expect } from "vitest";
import { PerceptionEngine, collectSoundSources, footstepConfidence, DEFAULT_PARAMS } from "../src/index.js";
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

describe("footsteps — the distance rule (running is heard within the audio radius, through walls)", () => {
  const R = DEFAULT_PARAMS.hearing.footstepRadiusUnits;
  const listenerPos = zonePos(spatial, "a-site");
  const listener = mkPlayer({ id: "obs", teamId: "defenders", side: "defense", position: listenerPos });
  const steps = (others: ReturnType<typeof mkPlayer>[]) =>
    new PerceptionEngine(spatial).observe(mkWorld([listener, ...others]), "obs")!.audibleEvents.filter((s) => s.kind === "footstep");
  const enemyAt = (dx: number, behaviorState: string, id = "e") =>
    mkPlayer({ id, teamId: "attackers", side: "attack", position: { x: listenerPos.x + dx, y: listenerPos.y, z: listenerPos.z }, behaviorState });

  it("counterfactual — same spot, same route: running is heard, walking is not", () => {
    expect(steps([enemyAt(0.6 * R, "running")])).toHaveLength(1);
    expect(steps([enemyAt(0.6 * R, "walking")])).toHaveLength(0);
    expect(steps([enemyAt(0.6 * R, "still")])).toHaveLength(0);
  });

  it("counterfactual — the same runner one step outside the radius is not heard", () => {
    expect(steps([enemyAt(R - 1, "running")])).toHaveLength(1);
    expect(steps([enemyAt(R + 1, "running")])).toHaveLength(0);
  });

  it("walls do not stop footsteps: a lobby with no sound link or sightline to the site is heard if it is in range", () => {
    // a-lobby has no sound-graph link to a-site (audibleZones is empty) but lies inside the radius.
    expect(spatial.audibleZones("a-lobby", 0.01).some((z) => z.zoneId === "a-site")).toBe(false);
    const lobby = zonePos(spatial, "a-lobby");
    const d = Math.hypot(lobby.x - listenerPos.x, lobby.y - listenerPos.y, lobby.z - listenerPos.z);
    expect(d).toBeLessThan(R);
    const heard = steps([mkPlayer({ id: "e", teamId: "attackers", side: "attack", position: lobby, behaviorState: "running" })]);
    expect(heard).toHaveLength(1);
    // zone-level localisation: the cue points at the lobby's centre
    expect(heard[0]!.approxPosition.x).toBeCloseTo(lobby.x, 3);
  });

  it("confidence falls linearly with distance: 1 at the listener, 0 at the edge", () => {
    expect(footstepConfidence(0, R)).toBe(1);
    expect(footstepConfidence(R / 2, R)).toBeCloseTo(0.5);
    expect(footstepConfidence(R, R)).toBe(0);
    expect(footstepConfidence(R + 1, R)).toBe(0);
    const near = steps([enemyAt(0.2 * R, "running")])[0]!.confidence;
    const far = steps([enemyAt(0.8 * R, "running")])[0]!.confidence;
    expect(near).toBeGreaterThan(far);
  });

  it("one cue per distinct runner, with no identity; a teammate's steps are not a cue", () => {
    const two = steps([enemyAt(0.3 * R, "running", "e1"), enemyAt(0.3 * R, "running", "e2")]);
    expect(two).toHaveLength(2);
    expect(JSON.stringify(two)).not.toMatch(/e1|e2/);
    const mate = mkPlayer({ id: "mate", teamId: "defenders", side: "defense", position: listenerPos, behaviorState: "running" });
    expect(steps([mate])).toHaveLength(0);
  });
});
