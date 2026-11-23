import { describe, it, expect } from "vitest";
import { AVERAGE_SKILLS, type WeaponSpec } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { infoWeight, soundCueConfidence, TRACER_CUE_CONFIDENCE } from "../src/situational.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, scenePos, hiddenSpot } from "./fixtures/setup.js";

const spatial = loadSpatial();
const baseWeapons = loadWeapons();

function mk(id: string, side: "attack" | "defense", zoneId: string, weaponId: string): SimPlayer {
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...scenePos(spatial, zoneId) }, zoneId, facing: { x: 1, y: 0 }, health: 100, armor: 50, alive: true, weaponId,
    skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

/**
 * Counterfactual: ONE property changes — whether the attacker's rifle shows tracers to enemies.
 * Everything else (damage, fire rate, positions, seed) is identical, so the fight itself cannot
 * differ; only what the defenders can OBSERVE of it may.
 *
 * atk (a-main) duels def1 (a-site). def2 stands on a-rafters looking away: it has a sightline onto
 * the fight's zone but does not see the attacker, and the shot is not audible there.
 */
function run(tracerVisible: boolean) {
  const rifle: WeaponSpec = { ...baseWeapons["Vandal"]!, tracerVisible };
  const weapons = { ...baseWeapons, Rifle: rifle };
  const defenseViews: PolicyView[] = [];
  const hold = (aim: Record<string, string>): DecisionPolicy => ({
    decide: (v: PolicyView): PolicyDecision => {
      if (v.side === "defense") defenseViews.push(v);
      return {
        strategy: "defaultHold", roles: [],
        commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone: aim[p.id] ?? "a-site" })),
      };
    },
  });
  const state: SimState = {
    matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 6000,
    // def2 stands on a part of A Rafters the attacker's spot cannot see (and that cannot see it)
    players: [mk("atk", "attack", "a-main", "Rifle"), mk("def1", "defense", "a-site", "Rifle"),
      { ...mk("def2", "defense", "a-rafters", "Rifle"), position: { ...hiddenSpot(spatial, "a-rafters", scenePos(spatial, "a-main")) } }],
    spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
  };
  const sim = new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: { attack: hold({ atk: "a-site" }), defense: hold({ def1: "a-main", def2: "defender-spawn" }) }, // def2 looks the other way: from A Rafters it would otherwise SEE the attacker
    config: { seed: 7, roundTimeMs: 6000, traceCommands: true },
  });
  const result = sim.runRound(state);
  const fromAtk = (result.cueTrace ?? []).filter((c) => c.shooterId === "atk" && c.observerSide === "defense");
  const heardByDefense = defenseViews.flatMap((v) => v.observation.audibleEvents.filter((s) => s.kind === "gunfire"));
  return { result, fromAtk, heardByDefense };
}

describe("shot cues: weapon observability changes what the enemy can infer", () => {
  it("the fight is identical — only the tracer property differs", () => {
    const withTracer = run(true);
    const noTracer = run(false);
    const kills = (r: ReturnType<typeof run>) => r.result.events.filter((e) => e.kind === "kill").map((e) => `${e.elapsedMs}:${e.actor}>${e.target}`);
    expect(kills(withTracer)[0]).toBeDefined();
    expect(kills(noTracer)[0]).toBe(kills(withTracer)[0]);
  });

  it("visible tracers give the unsighted defender a firm cue; without them it gets nothing", () => {
    const withTracer = run(true);
    const noTracer = run(false);
    expect(withTracer.fromAtk.some((c) => c.channel === "tracer" && c.confidence === TRACER_CUE_CONFIDENCE)).toBe(true);
    expect(noTracer.fromAtk.some((c) => c.channel === "tracer")).toBe(false);
    // The cue reaches the defending team's observation (the policy's input), not just a log.
    expect(Math.max(0, ...withTracer.heardByDefense.map((s) => s.confidence))).toBe(TRACER_CUE_CONFIDENCE);
    expect(noTracer.heardByDefense).toHaveLength(0);
  });

  it("a cue is evidence about a zone, never the shooter's exact position", () => {
    const { fromAtk } = run(true);
    const zone = spatial.getZone("a-main")!.position;
    for (const c of fromAtk) expect(c.zonePosition).toEqual({ x: zone.x, y: zone.y, z: zone.z });
  });

  it("same seed and state → identical cues", () => {
    expect(run(true).fromAtk).toEqual(run(true).fromAtk);
  });
});

describe("cue confidence → usable information", () => {
  it("a heard shot is looser than a seen tracer, and silence below the audible threshold", () => {
    expect(soundCueConfidence(0.8)).toBeCloseTo(0.48);
    expect(soundCueConfidence(0.8)).toBeLessThan(TRACER_CUE_CONFIDENCE);
    expect(soundCueConfidence(0.1)).toBe(0);
    expect(soundCueConfidence(0.8, 0.1)).toBe(0); // a quiet enough weapon is not heard at that range
  });
  it("only a firm cue is a pre-aimable call (weight ≥ 0.5): tracer yes, sound alone no", () => {
    expect(infoWeight(0, 2000, 0.6, TRACER_CUE_CONFIDENCE)).toBeGreaterThanOrEqual(0.5);
    expect(infoWeight(0, 2000, 0.6, soundCueConfidence(0.8))).toBeLessThan(0.5);
    expect(infoWeight(3000, 2000, 0.6, TRACER_CUE_CONFIDENCE)).toBeLessThan(0.5); // and it goes stale
  });
});
