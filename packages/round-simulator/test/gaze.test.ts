import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { turnRateRadPerMs, rotateToward, TURN_RATE_DEG_PER_S } from "../src/gaze.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

function run(seed: number, gaze: boolean, traceCommands = false) {
  const s = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed, recordTracks: true, gaze, traceCommands },
  });
  return s.runRound(makeSyntheticRound(spatial));
}

describe("gaze as state (SimConfig.gaze)", () => {
  it("rotateToward never turns more than the allowed angle", () => {
    const r = rotateToward({ x: 1, y: 0 }, { x: -1, y: 0.001 }, Math.PI / 6);
    expect(Math.atan2(r.y, r.x)).toBeCloseTo(Math.PI / 6, 9);
    const done = rotateToward({ x: 1, y: 0 }, { x: 1, y: 1 }, Math.PI);
    expect(Math.atan2(done.y, done.x)).toBeCloseTo(Math.PI / 4, 9);
  });

  it("turn rate is bounded and grows with aim and reaction", () => {
    const slow = turnRateRadPerMs({ aim: 0, reaction: 0 }), fast = turnRateRadPerMs({ aim: 1, reaction: 1 });
    expect(slow * 1000 * 180 / Math.PI).toBeCloseTo(TURN_RATE_DEG_PER_S.slow, 6);
    expect(fast * 1000 * 180 / Math.PI).toBeCloseTo(TURN_RATE_DEG_PER_S.fast, 6);
  });

  it("in a round, no player's facing turns faster than its turn rate between two ticks", () => {
    const r = run(3, true);
    const maxDeg = (TURN_RATE_DEG_PER_S.fast * 100) / 1000 + 1e-6; // per 100 ms tick, upper bound over skills
    for (let i = 1; i < r.tracks!.length; i++) {
      const prev = new Map(r.tracks![i - 1]!.players.map((p) => [p.id, p]));
      for (const p of r.tracks![i]!.players) {
        const q = prev.get(p.id);
        if (!p.facing || !q?.facing || !p.alive) continue;
        const d = Math.abs(Math.atan2(p.facing.x * q.facing.y - p.facing.y * q.facing.x, p.facing.x * q.facing.x + p.facing.y * q.facing.y)) * 180 / Math.PI;
        expect(d).toBeLessThanOrEqual(maxDeg);
      }
    }
  });

  it("teammates split believed spots: two teammates never look at the same believed spot on one tick", () => {
    let threatTicks = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = run(seed, true);
      for (const f of r.tracks!) {
        for (const side of ["attack", "defense"] as const) {
          const looks = f.players.filter((p) => p.side === side && p.gaze === "threat" && p.look).map((p) => `${Math.round(p.look!.x)},${Math.round(p.look!.y)}`);
          threatTicks += looks.length;
          expect(new Set(looks).size).toBe(looks.length);
        }
      }
    }
    expect(threatTicks).toBeGreaterThan(0);
  });

  it("with gaze on, duels carry each side's aim offset and ready time; off, the round is the calibrated one", () => {
    const on = run(4, true, true);
    const duel = on.engagementTrace!.find((e) => e.aimOffsetDeg);
    expect(duel).toBeDefined();
    expect(duel!.readyMs!.attacker).toBeGreaterThan(0);
    const off1 = run(4, false), off2 = run(4, false);
    expect(off1.events).toEqual(off2.events);
    for (const f of off1.tracks!) for (const p of f.players) expect(p.look).toBeUndefined();
  });
});
