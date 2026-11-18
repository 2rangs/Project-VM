import { describe, it, expect } from "vitest";
import { buildAbilityCatalog, abilitySpecFromCatalog, type AbilityCatalog } from "@pv/ability-engine";
import { AVERAGE_SKILLS } from "@pv/combat-engine";
import {
  RoundSimulator, type DecisionPolicy, type PolicyDecision, type PolicyView, type SimPlayer, type SimState,
} from "../src/index.js";
import { loadSpatial, loadWeapons } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();

// A recon cast thrown FAR AWAY (no LoS block, no damage, no local reveal) isolates the caster's
// occupation. windup 700 → the caster is weapon-unready during the duel; windup 0 → no occupation.
function reconCatalog(windupMs: number): AbilityCatalog {
  return buildAbilityCatalog([
    abilitySpecFromCatalog(
      { abilityId: "sova:Ability2", slot: "Ability2", name: "Recon Bolt", effectTypes: ["recon"], params: { radiusMeters: 25, rangeMeters: 100, durationMs: 3000, revealDurationMs: 3000, windupMs } },
      { charges: 1 },
    ),
  ]);
}

function atk(cast: boolean): SimPlayer {
  const z = spatial.getZone("a-main")!, site = spatial.getZone("a-site")!.position;
  return {
    id: "atk", teamId: "attackers", side: "attack", agentId: "a",
    position: { ...z.position }, zoneId: "a-main", facing: { x: site.x - z.position.x, y: site.y - z.position.y },
    health: 100, armor: 0, alive: true, weaponId: "Vandal", skills: AVERAGE_SKILLS,
    abilities: cast ? [{ abilityId: "sova:Ability2", slot: "basic", chargesRemaining: 1, lastUsedAtMs: null }] : [],
    ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run",
  };
}
function def(): SimPlayer {
  const z = spatial.getZone("a-site")!, main = spatial.getZone("a-main")!.position;
  return { id: "def", teamId: "defenders", side: "defense", agentId: "a", position: { ...z.position }, zoneId: "a-site", facing: { x: main.x - z.position.x, y: main.y - z.position.y }, health: 100, armor: 0, alive: true, weaponId: "Vandal", skills: AVERAGE_SKILLS, abilities: [], ultimatePoints: 0, ultimateCost: 7, path: [], pathIndex: 0, edgeProgressMs: 0, moveMode: "run" };
}

// attacker casts recon far away at the first decision (busy during the duel), then holds; defender holds.
// aimZone a-site on the cast command too, so the attacker faces the defender identically in both
// cases — the ONLY difference is the cast windup (isolating its penalty).
const castPolicy: DecisionPolicy = { decide: (v: PolicyView): PolicyDecision => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => v.timeRemainingMs > 59000 ? { playerId: p.id, kind: "useAbility" as const, abilityId: "sova:Ability2", targetZone: "b-site", aimZone: "a-site" } : { playerId: p.id, kind: "hold" as const, aimZone: "a-site" }) }) };
const holdAtk: DecisionPolicy = { decide: (v: PolicyView): PolicyDecision => ({ strategy: "default", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone: "a-site" })) }) };
const holdDef: DecisionPolicy = { decide: (v: PolicyView): PolicyDecision => ({ strategy: "defaultHold", roles: [], commands: v.teammates.filter((p) => p.alive).map((p) => ({ playerId: p.id, kind: "hold" as const, aimZone: "a-main" })) }) };

function openingAttackWins(cast: boolean, windupMs: number, n = 200): number {
  const catalog = reconCatalog(windupMs);
  let win = 0, dec = 0;
  for (let seed = 1; seed <= n; seed++) {
    const state: SimState = {
      matchId: "m", roundId: "r", mapId: "ascent", tick: 0, elapsedMs: 0, timeRemainingMs: 60000,
      players: [atk(cast), def()],
      spike: { phase: "carried", carrierId: "atk", zoneId: null, position: null, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: null },
    };
    const r = new RoundSimulator({ spatial, weapons, abilities: catalog, policies: { attack: cast ? castPolicy : holdAtk, defense: holdDef }, config: { seed, roundTimeMs: 8000, traceCommands: true } }).runRound(state);
    const f = r.engagementTrace?.[0];
    if (f?.winnerSide === "attack") { win++; dec++; } else if (f?.winnerSide === "defense") dec++;
  }
  return win / Math.max(1, dec);
}

describe("cast windup occupies the caster (bounded to the windup)", () => {
  const noCast = openingAttackWins(false, 700);

  it("an attacker caught mid-cast (windup active) wins the duel far less often", () => {
    const midCast = openingAttackWins(true, 700);
    expect(midCast).toBeLessThan(noCast); // weapon-unready during the windup → loses the duel
  });

  it("the penalty is the windup, not casting itself: windup 0 fights like no cast (bounded)", () => {
    const zeroWindup = openingAttackWins(true, 0);
    expect(Math.abs(zeroWindup - noCast)).toBeLessThan(0.05); // no occupation → no penalty
  });

  it("is deterministic", () => {
    expect(openingAttackWins(true, 700, 50)).toBe(openingAttackWins(true, 700, 50));
  });
});
