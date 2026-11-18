import { describe, it, expect } from "vitest";
import { runMatchRound, ScriptedPolicy, type MatchRoundInput, type MatchRoundTeam } from "../src/index.js";
import { SYNTHETIC_DEFENSE_ANCHORS } from "../src/index.js";
import { loadSpatial, loadWeapons, NO_ABILITIES, spatialQuery } from "./fixtures/setup.js";

const spatial = loadSpatial();
const weapons = loadWeapons();
const sq = spatialQuery(spatial);

function team(prefix: string, side: "attack" | "defense", count = 5): MatchRoundTeam {
  const anchors = side === "defense" ? ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"] : [];
  return {
    teamId: side === "attack" ? "attackers" : "defenders",
    players: Array.from({ length: count }, (_, i) => ({
      id: `${prefix}${i + 1}`,
      agentId: "omen",
      spawnZoneId: side === "defense" ? anchors[i] : "attacker-spawn",
      loadout: {
        weaponId: "Vandal",
        armor: 50,
        ultimatePoints: 6,
        ultimateCost: 7,
        abilities: [{ abilityId: "omen:Ultimate", slot: "ultimate" as const, charges: 1 }],
      },
    })),
    economy: { teamId: side === "attack" ? "attackers" : "defenders", side, credits: 3900, lossBonusTier: 0, consecutiveLosses: 0 },
  };
}

function input(seed: number): MatchRoundInput {
  return {
    spatial, weapons, abilities: NO_ABILITIES,
    policies: {
      attack: new ScriptedPolicy(sq, { attackSite: "a-site" }),
      defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }),
    },
    attackers: team("atk", "attack"),
    defenders: team("def", "defense"),
    seed,
    mapId: "ascent",
    matchId: "m1",
    roundNumber: 1,
    config: { roundTimeMs: 100000 },
  };
}

describe("runMatchRound (PV-3 Match Runner API)", () => {
  it("returns a winner, an EventLog, and a per-player outcome for all 10 players", () => {
    const out = runMatchRound(input(42));
    expect(["attack", "defense"]).toContain(out.winner);
    expect(out.events.length).toBeGreaterThan(0);
    expect(out.players).toHaveLength(10);
    expect(out.survivors.attack.length + out.survivors.defense.length).toBeLessThanOrEqual(10);
  });

  it("is deterministic: same seed ⇒ identical winner + per-player outcomes", () => {
    const a = runMatchRound(input(7));
    const b = runMatchRound(input(7));
    expect(a.winner).toBe(b.winner);
    expect(a.players).toEqual(b.players);
    // a different seed may diverge, but must still be well-formed
    const c = runMatchRound(input(99));
    expect(c.players).toHaveLength(10);
  });

  it("equipment preservation: survivors keep their weapon/armor, dead keep nothing", () => {
    const out = runMatchRound(input(3));
    for (const p of out.players) {
      if (p.alive) {
        expect(p.weaponRetained).toBe("Vandal");
        expect(p.armorRetained).toBe(50);
        expect(p.died).toBe(false);
      } else {
        expect(p.weaponRetained).toBeNull();
        expect(p.armorRetained).toBe(0);
        expect(p.abilitiesRemaining).toHaveLength(0);
      }
    }
  });

  it("ultimate-point changes: kills earn points, end is capped at cost, totals reconcile", () => {
    const out = runMatchRound(input(11));
    const killEvents = out.events.filter((e) => e.kind === "kill").length;
    const totalKills = out.players.reduce((s, p) => s + p.kills, 0);
    expect(totalKills).toBe(killEvents);
    for (const p of out.players) {
      // start 6 + earned; a non-casting player is capped at cost 7
      expect(p.ultimatePointsEarned).toBeGreaterThanOrEqual(p.kills); // pointForKill >= 1
      if (!p.ultimateUsed) expect(p.ultimatePointsEnd).toBeLessThanOrEqual(7);
      expect(p.ultimatePointsEnd).toBeGreaterThanOrEqual(0);
    }
  });
});
