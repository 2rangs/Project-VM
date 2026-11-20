import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "@pv/perception-engine";
import { SPIKE_RULES, spikeBlastRadiusUnits } from "@pv/game-rules";
import { buildPolicyView, type SimPlayer, type SimState } from "../src/index.js";
import { roundPerceptionParams } from "../src/view.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { loadSpatial, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);

/** A player at a zone centre; `moving` puts it on a route (run or walk) so it is in motion this tick. */
function mk(id: string, side: "attack" | "defense", zoneId: string, moving: false | "run" | "walk" = false, toward = "attacker-spawn"): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 0, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7,
    path: moving ? [zoneId, toward] : [], pathIndex: moving ? 1 : 0, edgeProgressMs: 0, moveMode: moving || "run",
  };
}
const stateOf = (players: SimPlayer[]): SimState => ({
  matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000, players,
  spike: { phase: "carried", carrierId: null, zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
});
const heard = (players: SimPlayer[]) =>
  buildPolicyView("defense", stateOf(players), new PerceptionEngine(spatial, { params: roundPerceptionParams() }), sq)
    .observation.audibleEvents.filter((e) => e.kind === "footstep");

describe("footsteps reach the team's observation (world rule → PolicyView)", () => {
  it("the audio radius IS the spike's blast radius (one rule, one number)", () => {
    expect(roundPerceptionParams().hearing.footstepRadiusUnits).toBe(spikeBlastRadiusUnits());
    expect(SPIKE_RULES.blastRadiusM.verified).toBe(false); // an approximation, and flagged as one
  });

  it("counterfactual — the same attackers on the same route: running is heard by the defense, walking is not", () => {
    const defenders = [mk("def1", "defense", "a-site"), mk("def2", "defense", "b-site")];
    expect(heard([...defenders, mk("atk1", "attack", "a-main", "run", "a-site")])).toHaveLength(1);
    expect(heard([...defenders, mk("atk1", "attack", "a-main", "walk", "a-site")])).toHaveLength(0);
    expect(heard([...defenders, mk("atk1", "attack", "a-main", false)])).toHaveLength(0);
  });

  it("out of every defender's radius: not heard", () => {
    // attacker spawn is farther than the radius from both sites (but a mid defender would hear it)
    const sites = [mk("def1", "defense", "a-site"), mk("def2", "defense", "b-site")];
    expect(heard([...sites, mk("atk1", "attack", "attacker-spawn", "run", "a-lobby")])).toHaveLength(0);
    expect(heard([...sites, mk("def5", "defense", "mid-courtyard"), mk("atk1", "attack", "attacker-spawn", "run", "a-lobby")])).toHaveLength(1);
  });

  it("one cue per distinct runner for the TEAM: three listeners hearing two runners is two, not six", () => {
    const listeners = [mk("def1", "defense", "a-site"), mk("def2", "defense", "a-site"), mk("def3", "defense", "a-rafters")];
    const cues = heard([...listeners, mk("atk1", "attack", "a-main", "run", "a-site"), mk("atk2", "attack", "a-main", "run", "a-site")]);
    expect(cues).toHaveLength(2);
    // zone-level: both point at a-main's centre, and carry a confidence in (0, 1]
    const aMain = spatial.getZone("a-main")!.position;
    for (const c of cues) {
      expect(c.approxPosition.x).toBeCloseTo(aMain.x, 3);
      expect(c.confidence).toBeGreaterThan(0);
      expect(c.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("runners in different places are separate cues", () => {
    const listeners = [mk("def5", "defense", "mid-courtyard")];
    const cues = heard([...listeners, mk("atk1", "attack", "a-lobby", "run", "a-main"), mk("atk2", "attack", "b-lobby", "run", "b-main")]);
    expect(cues).toHaveLength(2);
  });

  it("a team does not hear its own runners", () => {
    expect(heard([mk("def1", "defense", "a-site"), mk("def2", "defense", "a-site", "run", "a-main")])).toHaveLength(0);
  });
});
