import { describe, it, expect } from "vitest";
import { PerceptionEngine } from "@pv/perception-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, buildPolicyView, makeSyntheticRound, SpatialQueryAdapter,
  type ActionCommand, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

function mk(id: string, side: "attack" | "defense", zoneId: string, facing = { x: 1, y: 0 }): SimPlayer {
  const z = spatial.getZone(zoneId)!;
  return {
    id, teamId: side === "attack" ? "attackers" : "defenders", side, agentId: "a",
    position: { ...z.position }, zoneId, facing, health: 100, armor: 50, alive: true, weaponId: "Vandal",
    skills: AVERAGE_SKILLS, abilities: [{ abilityId: "omen:Ability2", chargesRemaining: 1, lastUsedAtMs: null }],
    ultimatePoints: 3, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}

describe("PV-3 contract supplement", () => {
  it("teammates carry the required fields; perPlayerObservation and belief are populated", () => {
    const obsPos = spatial.getZone("a-main")!.position;
    const enemyPos = spatial.getZone("a-site")!.position;
    const atk = mk("atk", "attack", "a-main", { x: enemyPos.x - obsPos.x, y: enemyPos.y - obsPos.y });
    const def = mk("def", "defense", "a-site");
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [atk, def],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const view = buildPolicyView("attack", state, new PerceptionEngine(spatial), new SpatialQueryAdapter(spatial));

    const t = view.teammates[0];
    expect(t.id).toBe("atk");
    expect(t.weapon?.weaponId).toBe("Vandal");
    expect(t.abilities[0].abilityId).toBe("omen:Ability2");
    expect(t.abilities[0].chargesRemaining).toBe(1);
    expect(t.ultimatePoints).toBe(3);
    expect(typeof t.credits).toBe("number");

    // atk sees def across the a-main<->a-site sightline → belief non-empty + perPlayerObs present
    expect(view.perPlayerObservation?.atk).toBeDefined();
    expect(view.observation.visibleEnemies.some((e) => e.currentlyVisible && e.playerId === "def")).toBe(true);
    expect(view.belief.enemyPositionBeliefs.length).toBeGreaterThan(0);
    expect(view.belief.enemyPositionBeliefs[0].enemyId).toBe("def");
  });
});

describe("executeAtMs (teamwork timing)", () => {
  // a policy that tells everyone to push a-site, but not before executeAtMs
  class DelayedPush implements DecisionPolicy {
    constructor(private readonly at: number) {}
    decide(view: PolicyView): PolicyDecision {
      const commands: ActionCommand[] = view.teammates.filter((p) => p.alive && p.side === "attack").map((p) => ({ playerId: p.id, kind: "move", targetZone: "a-main", moveMode: "run", executeAtMs: this.at }));
      return { strategy: "aExecute", roles: [], commands };
    }
  }
  const hold: DecisionPolicy = { decide: (v) => ({ strategy: "defaultHold", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" })) }) };

  function firstMoveTick(at: number): number {
    const r = new RoundSimulator({
      spatial, weapons, abilities: NO_ABILITIES,
      policies: { attack: new DelayedPush(at), defense: hold },
      config: { seed: 1, roundTimeMs: 20000, recordTracks: true },
    }).runRound(makeSyntheticRound(spatial));
    // first frame where any attacker left the attacker-spawn position
    const spawn = spatial.getZone("attacker-spawn")!.position;
    const moved = r.tracks!.find((f) => f.players.some((p) => p.id.startsWith("atk") && (p.x !== spawn.x || p.y !== spawn.y)));
    return moved ? moved.elapsedMs : Infinity;
  }

  it("holds commands until their executeAtMs, deterministically", () => {
    const t0 = firstMoveTick(0); // immediate push: first position change after one zone hop
    const t6 = firstMoveTick(6000); // delayed push: same hop, shifted later by the delay
    expect(t0).toBeLessThan(Infinity);
    expect(t6 - t0).toBeGreaterThanOrEqual(5800);
    expect(t6 - t0).toBeLessThanOrEqual(6200);
    expect(firstMoveTick(6000)).toBe(t6); // deterministic
  });
});
