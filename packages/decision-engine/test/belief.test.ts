import { describe, it, expect } from "vitest";
import {
  buildTeamBelief,
  advanceTeamBelief,
  observeTeamBelief,
  spreadFromZone,
  enemyPressureOnZone,
  buildBeliefState,
} from "@pv/decision-engine";
import type { BeliefState } from "@pv/shared-types";
import { asPlayerId, asTeamId, asZoneId, type ObservationState } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const spatial = new AscentSpatialStub();

function obsWithEnemy(stalenessMs: number): ObservationState {
  const now = 50_000;
  return {
    observerId: asPlayerId("atk1"),
    teamId: asTeamId("team-0"),
    timestampMs: now,
    visibleEnemies: [
      {
        playerId: asPlayerId("def1"),
        agentId: null,
        lastSeenPosition: { x: 780, y: 360, z: 0 }, // a-site anchor
        lastSeenAtMs: now - stalenessMs,
        healthBand: "unknown",
        observedWeaponId: null,
        currentlyVisible: stalenessMs === 0,
      },
    ],
    audibleEvents: [],
    teammateReports: [],
    knownMapChanges: [],
  };
}

const sum = (m: ReadonlyMap<unknown, number>) => [...m.values()].reduce((a, b) => a + b, 0);

describe("Belief State v0 (Handoff §12.4, README §17.3)", () => {
  it("a freshly observed enemy collapses to a point mass at its zone", () => {
    const model = buildTeamBelief(obsWithEnemy(0), spatial);
    expect(model.enemyBeliefs).toHaveLength(1);
    const b = model.enemyBeliefs[0]!;
    expect(b.mostLikelyZone).toBe("a-site");
    expect(b.distribution.get(asZoneId("a-site"))).toBe(1);
    expect(b.distribution.size).toBe(1);
  });

  it("belief spreads over reachable zones as staleness grows, origin stays most likely", () => {
    const fresh = buildTeamBelief(obsWithEnemy(0), spatial).enemyBeliefs[0]!;
    const stale = buildTeamBelief(obsWithEnemy(9000), spatial).enemyBeliefs[0]!;
    expect(stale.distribution.size).toBeGreaterThan(fresh.distribution.size);
    expect(stale.mostLikelyZone).toBe("a-site");
    expect(Math.abs(sum(stale.distribution) - 1)).toBeLessThan(1e-9);
    // The peak probability drops as uncertainty spreads.
    expect(stale.distribution.get(asZoneId("a-site"))!).toBeLessThan(1);
  });

  it("advanceTeamBelief diffuses further with elapsed time (more zones, lower peak)", () => {
    const t0 = buildTeamBelief(obsWithEnemy(2000), spatial);
    const t1 = advanceTeamBelief(t0, 8000, spatial);
    const b0 = t0.enemyBeliefs[0]!;
    const b1 = t1.enemyBeliefs[0]!;
    expect(b1.stalenessMs).toBe(10_000);
    expect(b1.distribution.size).toBeGreaterThanOrEqual(b0.distribution.size);
    expect(b1.distribution.get(asZoneId("a-site"))!).toBeLessThanOrEqual(
      b0.distribution.get(asZoneId("a-site"))!,
    );
    expect(t1.atMs).toBe(t0.atMs + 8000);
  });

  it("re-observation collapses the re-seen enemy back to a tight distribution", () => {
    const stale = buildTeamBelief(obsWithEnemy(9000), spatial);
    const reobserved = observeTeamBelief(stale, obsWithEnemy(0), spatial);
    const b = reobserved.enemyBeliefs.find((x) => x.enemyId === asPlayerId("def1"))!;
    expect(b.distribution.size).toBe(1);
    expect(b.mostLikelyZone).toBe("a-site");
  });

  it("spreadFromZone yields a point mass at age 0 and a normalized spread after", () => {
    const point = spreadFromZone(asZoneId("a-site"), 0, spatial);
    expect(point.size).toBe(1);
    const spread = spreadFromZone(asZoneId("a-site"), 8000, spatial);
    expect(spread.size).toBeGreaterThan(1);
    expect(Math.abs(sum(spread) - 1)).toBeLessThan(1e-9);
  });

  it("enemyPressureOnZone aggregates probability across enemies", () => {
    const model = buildTeamBelief(obsWithEnemy(0), spatial);
    expect(enemyPressureOnZone(model, asZoneId("a-site"))).toBeGreaterThan(0);
    expect(enemyPressureOnZone(model, asZoneId("b-site"))).toBe(0);
  });

  it("buildBeliefState produces the shared BeliefState the PolicyView contract requires", () => {
    const obs = obsWithEnemy(0);
    const belief: BeliefState = buildBeliefState(null, obs, spatial, 0);
    expect(belief.playerId).toBe(obs.observerId);
    expect(belief.enemyPositionBeliefs).toHaveLength(1);
    expect(belief.enemyPositionBeliefs[0]!.enemyId).toBe(asPlayerId("def1"));
    expect(belief.threatZones.length).toBeGreaterThan(0);
    expect(belief.confidence).toBeGreaterThan(0);
  });

  it("buildBeliefState carries unobserved enemies forward, aged by dtMs", () => {
    const seen = buildBeliefState(null, obsWithEnemy(0), spatial, 0);
    // Next tick: no enemies observed → the prior belief is carried and aged.
    const emptyObs = { ...obsWithEnemy(0), visibleEnemies: [] };
    const next = buildBeliefState(seen, emptyObs, spatial, 3000);
    const carried = next.enemyPositionBeliefs.find((b) => b.enemyId === asPlayerId("def1"));
    expect(carried).toBeDefined();
    expect(carried!.staleness).toBe(3000);
  });

  it("is deterministic for the same observation", () => {
    const a = buildTeamBelief(obsWithEnemy(5000), spatial);
    const b = buildTeamBelief(obsWithEnemy(5000), spatial);
    expect(a.enemyBeliefs[0]!.mostLikelyZone).toBe(b.enemyBeliefs[0]!.mostLikelyZone);
    expect([...a.enemyBeliefs[0]!.distribution.entries()]).toEqual([
      ...b.enemyBeliefs[0]!.distribution.entries(),
    ]);
  });
});
