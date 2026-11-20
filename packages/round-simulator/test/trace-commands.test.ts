import { describe, it, expect } from "vitest";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, type SimPlayer, type SimState } from "../src/index.js";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const sq = spatialQuery(spatial);
const weapons = loadWeapons();

/** One attacker on A Main, one defender far away at its spawn: nobody meets. */
function aloneOnMain(): SimState {
  const base = makeSyntheticRound(spatial);
  const keep = (p: SimPlayer): boolean => p.id === "atk1" || p.id === "def1";
  const players = base.players.filter(keep).map((p) => {
    const zone = spatial.getZone(p.id === "atk1" ? "a-main" : "defender-spawn")!;
    return { ...p, zoneId: zone.id, position: { ...zone.position } };
  });
  return { ...base, players, spike: { ...base.spike, carrierId: "atk1" } };
}

function syntheticRun(traceCommands: boolean) {
  return new RoundSimulator({
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: "a-site" }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    config: { seed: 9, roundTimeMs: 40000, traceCommands },
  }).runRound(makeSyntheticRound(spatial));
}

describe("traceCommands (policy-debugging aid)", () => {
  it("is off by default: no commandTrace", () => {
    expect(syntheticRun(false).commandTrace).toBeUndefined();
  });

  it("records issued commands and executed movement, deterministically", () => {
    const r = syntheticRun(true);
    expect(r.commandTrace).toBeDefined();
    const t = r.commandTrace!;
    expect(t.length).toBeGreaterThan(0);
    // issued commands are captured with their kind
    expect(t.some((e) => e.phase === "issued" && e.command === "move")).toBe(true);
    // zone changes are traced as the mover crosses into each zone ...
    expect(t.some((e) => e.phase === "move" && e.fromZone && e.toZone)).toBe(true);
    // ... and arrival when it reaches its standing spot (here: an unopposed walk onto A Site)
    const walk = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: { decide: (v) => ({ strategy: "aExecute", roles: [], commands: v.teammates.map((p) => ({ playerId: p.id, kind: "move" as const, targetZone: "a-site", moveMode: "run" as const })) }) }, defense: { decide: () => ({ strategy: "defaultHold", roles: [], commands: [] }) } },
      config: { seed: 9, roundTimeMs: 40000, traceCommands: true },
    }).runRound(aloneOnMain());
    const arrived = walk.commandTrace!.find((e) => e.phase === "arrived");
    expect(arrived?.toZone).toBe("a-site");
    expect(walk.commandTrace!.findIndex((e) => e.phase === "arrived")).toBeGreaterThan(walk.commandTrace!.findIndex((e) => e.phase === "move" && e.toZone === "a-site"));
    // every entry carries tick + player
    for (const e of t) {
      expect(typeof e.tick).toBe("number");
      expect(typeof e.playerId).toBe("string");
    }
    // deterministic
    expect(syntheticRun(true).commandTrace).toEqual(t);
  });

  it("records engagementTrace with first-contact posture for every duel", () => {
    const r = syntheticRun(true);
    expect(r.engagementTrace).toBeDefined();
    expect(r.engagementTrace!.length).toBeGreaterThan(0);
    const e = r.engagementTrace![0];
    expect(typeof e.attackerId).toBe("string");
    expect(typeof e.defenderId).toBe("string");
    expect(["attacker", "defender", "mutual"]).toContain(e.firstSight);
    expect(typeof e.attackerPreAim).toBe("boolean");
    expect(typeof e.defenderMoving).toBe("boolean");
    expect(e.distanceMeters).toBeGreaterThan(0);
    // off by default
    expect(syntheticRun(false).engagementTrace).toBeUndefined();
  });

  it("captures a plant attempt with its result/rejection reason", () => {
    const aSite = spatial.getZone("a-site")!;
    const bSite = spatial.getZone("b-site")!;
    const carrier: SimPlayer = {
      id: "atk", teamId: "attackers", side: "attack", agentId: "a",
      position: { ...aSite.position }, zoneId: "a-site", facing: { x: 1, y: 0 },
      health: 100, armor: 0, alive: true, weaponId: "Vandal", skills: AVERAGE_SKILLS,
      abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
    };
    const defender: SimPlayer = { ...carrier, id: "def", teamId: "defenders", side: "defense", position: { ...bSite.position }, zoneId: "b-site" };
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 40000,
      players: [carrier, defender],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new ScriptedPolicy(sq, { attackSite: "a-site" }), defense: new ScriptedPolicy(sq) },
      config: { seed: 1, traceCommands: true },
    }).runRound(state);
    // the carrier is already on the plantable a-site → plant trace shows it started
    const plant = r.commandTrace!.filter((e) => e.phase === "plant");
    expect(plant.length).toBeGreaterThan(0);
    expect(plant.some((e) => e.result === "started" || e.result === "planting")).toBe(true);
    expect(r.events.some((e) => e.kind === "planted")).toBe(true);
  });
});
