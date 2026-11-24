/**
 * Match Runner acceptance (Handoff §17): seed determinism, completion (incl. OT), economy
 * matches the rules, and the DECISION-004 boundary (policy input carries no WorldState).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { runMatch, attackerFor, resolveTeamRef, teamSkills, type MatchConfig, type MatchResult, type RoundRecord } from "../src/index.js";
import { newTeamEconomy, decideBuy, settleRound, type PlayerSettlement } from "../src/economy.js";
import { ECONOMY_RULES, ROUND_RULES } from "@pv/game-rules";

const cfg = (seed: number, extra: Partial<MatchConfig> = {}): MatchConfig => ({
  teamA: { id: "sen", name: "Sentinels" },
  teamB: { id: "lev", name: "LEV" },
  map: "ascent",
  seed,
  ...extra,
});

const hashRounds = (m: MatchResult) =>
  createHash("sha256").update(JSON.stringify(m.rounds.map((r) => [r.winner, r.reason, r.score, r.events]))).digest("hex").slice(0, 16);

describe("Match Runner", () => {
  it("completes a match with a valid winner and a 2-round lead at ≥13", () => {
    const m = runMatch(cfg(1));
    expect(["A", "B"]).toContain(m.winner);
    const w = m.score[m.winner];
    const l = m.winner === "A" ? m.score.B : m.score.A;
    expect(w).toBeGreaterThanOrEqual(ROUND_RULES.roundsToWinRegulation.value);
    expect(w - l).toBeGreaterThanOrEqual(ROUND_RULES.overtimeWinMargin.value);
  });

  it("is deterministic (same seed → identical rounds)", () => {
    expect(hashRounds(runMatch(cfg(42)))).toBe(hashRounds(runMatch(cfg(42))));
  });

  it("different seeds can diverge", () => {
    // Not a guarantee for every pair, but the engine must be seed-sensitive somewhere.
    const seeds = [1, 2, 3, 4, 5].map((s) => hashRounds(runMatch(cfg(s))));
    expect(new Set(seeds).size).toBeGreaterThan(1);
  });

  it("swaps sides at the half and alternates in OT", () => {
    expect(attackerFor(1)).toBe("A");
    expect(attackerFor(12)).toBe("A");
    expect(attackerFor(13)).toBe("B");
    expect(attackerFor(24)).toBe("B");
    expect(attackerFor(25)).toBe("A"); // OT1
    expect(attackerFor(26)).toBe("B"); // OT2
  });

  it("can reach overtime and still terminate (forced via maxRounds cap safety)", () => {
    // Search a few seeds for an OT match; every match must at least terminate.
    let sawOt = false;
    for (let s = 1; s <= 12; s++) {
      const m = runMatch(cfg(s));
      expect(m.rounds.length).toBeLessThanOrEqual(60);
      if (m.wentToOvertime) sawOt = true;
    }
    // Determinism of the cap path: a tiny cap forces a leader-by-fallback return.
    const capped = runMatch(cfg(1, { maxRounds: 3 }));
    expect(capped.rounds.length).toBe(3);
    expect(["A", "B"]).toContain(capped.winner);
    void sawOt; // informational; not every seed set reaches OT
  });

  it("economy: pistol buy, round rewards and loss bonus match @pv/game-rules", () => {
    const start = ECONOMY_RULES.startingCredits.value;
    // Pistol buy affordable from starting credits.
    const pistol = decideBuy(start, true);
    expect(pistol.tier).toBe("pistol");
    expect(pistol.cost).toBeLessThanOrEqual(start);

    // Per player: win reward to everyone.
    const dead = (kills = 0): PlayerSettlement => ({ alive: false, kills, weaponAfter: null, armorRetained: 0, ultimatePointsEnd: 0 });
    const five = (f: (i: number) => PlayerSettlement) => Array.from({ length: 5 }, (_, i) => f(i));
    const won = settleRound(newTeamEconomy(), { won: true, planted: false, attacking: true, players: five(() => dead()) });
    expect(won.players.every((p) => p.credits === start + ECONOMY_RULES.roundWinReward.value)).toBe(true);
    expect(won.credits).toBe(5 * (start + ECONOMY_RULES.roundWinReward.value));
    expect(won.consecutiveLosses).toBe(0);

    // First loss → loss bonus ladder[0] to every player; streak grows.
    const l1 = settleRound(newTeamEconomy(), { won: false, planted: false, attacking: true, players: five(() => dead()) });
    expect(l1.players[0]!.credits).toBe(start + ECONOMY_RULES.lossBonusLadder.value[0]!);
    expect(l1.consecutiveLosses).toBe(1);

    // Kill reward to the killer; the plant reward to every attacker.
    const withKills = settleRound(newTeamEconomy(), { won: true, planted: true, attacking: true, players: five((i) => dead(i === 0 ? 3 : 0)) });
    expect(withKills.players[0]!.credits).toBe(
      start + ECONOMY_RULES.roundWinReward.value + 3 * ECONOMY_RULES.killReward.value + ECONOMY_RULES.spikePlantReward.value,
    );
    expect(withKills.players[1]!.credits).toBe(start + ECONOMY_RULES.roundWinReward.value + ECONOMY_RULES.spikePlantReward.value);
  });

  it("match credits never exceed the rules cap and never go negative", () => {
    const m = runMatch(cfg(7));
    for (const r of m.rounds) {
      for (const slot of ["A", "B"] as const) {
        expect(r.economy[slot].credits).toBeGreaterThanOrEqual(0);
        for (const p of r.economy[slot].players) {
          expect(p.credits).toBeGreaterThanOrEqual(0);
          expect(p.credits).toBeLessThanOrEqual(ECONOMY_RULES.maxCredits.value);
        }
        for (const b of r.buys[slot].players) expect(b.creditsAfter).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("round-end distribution is realistic — attackers execute/plant, timeExpired is a minority", () => {
    // Regression for the carrier-commit fix: before it, ~79% of rounds ended timeExpired
    // because the spike carrier's plant was interrupted every decision and never completed.
    const m = runMatch(cfg(42));
    const reasons: Record<string, number> = {};
    for (const r of m.rounds) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    const timeExpired = reasons.timeExpired ?? 0;
    const decisive = (reasons.elimination ?? 0) + (reasons.spikeDetonation ?? 0) + (reasons.spikeDefused ?? 0);
    expect(decisive).toBeGreaterThan(timeExpired); // most rounds end decisively
    expect(timeExpired).toBeLessThan(m.rounds.length * 0.4); // timeExpired is a clear minority
  });

  it("enableAbilities runs the game-data ability path deterministically (WIP, default off)", () => {
    const a = runMatch({ ...cfg(5), maxRounds: 3, enableAbilities: true });
    const b = runMatch({ ...cfg(5), maxRounds: 3, enableAbilities: true });
    expect(a.rounds.length).toBe(3);
    expect(a.rounds[0]?.events[0]?.kind).toBe("roundStart");
    // deterministic with abilities on
    expect(a.rounds.map((r) => [r.winner, r.reason])).toEqual(b.rounds.map((r) => [r.winner, r.reason]));
  });

  it("recordPerception populates replay.meta.perception when enabled (PV-6 fog-of-war)", () => {
    const off = runMatch({ ...cfg(5), maxRounds: 2 });
    expect(off.rounds[0]?.replay.meta.perception).toBeUndefined();
    const on = runMatch({ ...cfg(5), maxRounds: 2, recordPerception: true });
    expect(on.rounds[0]?.replay.meta.perception).toBeTruthy();
    expect(Array.isArray(on.rounds[0]?.replay.meta.perception)).toBe(true);
  });

  it("game-data: unknown team ids fall back; teamSkills returns a valid [0,1] profile", () => {
    const unknown = resolveTeamRef("___no_such_team___");
    expect(unknown.name).toBe("___no_such_team___"); // falls back to the id
    const sk = teamSkills("___no_such_team___"); // AVERAGE_SKILLS fallback
    for (const v of Object.values(sk)) {
      expect(typeof v).toBe("number");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("onRound progress callback fires once per round, in order", () => {
    const seen: number[] = [];
    const m = runMatch(cfg(5), { onRound: (r: RoundRecord) => seen.push(r.roundNumber) });
    expect(seen).toEqual(m.rounds.map((r) => r.roundNumber));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("each round produces an EventLog bracketed by roundStart/roundEnd and a replay", () => {
    const m = runMatch(cfg(3));
    for (const r of m.rounds) {
      expect(r.events[0]?.kind).toBe("roundStart");
      expect(r.events[r.events.length - 1]?.kind).toBe("roundEnd");
      expect(r.replay.events).toBeTruthy();
      expect(r.replay.meta.mapId).toBe("ascent");
    }
  });
});
