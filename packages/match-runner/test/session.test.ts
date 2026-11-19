/**
 * Interactive match session + tactical timeouts (TASK: timeouts/interactive match).
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createMatchSession, runMatch, type MatchConfig, type TeamSlot } from "../src/index.js";
import { ROUND_RULES } from "@pv/game-rules";

const cfg = (seed: number, extra: Partial<MatchConfig> = {}): MatchConfig => ({
  teamA: { id: "sen", name: "Sentinels" },
  teamB: { id: "lev", name: "LEV" },
  map: "ascent",
  seed,
  ...extra,
});

const hashRounds = (rounds: readonly { winner: TeamSlot; reason: string }[]) =>
  createHash("sha256").update(JSON.stringify(rounds.map((r) => [r.winner, r.reason]))).digest("hex").slice(0, 16);

describe("MatchSession — tactical timeouts", () => {
  it("no timeouts/orders ⇒ byte-identical to runMatch", () => {
    const direct = runMatch(cfg(42));
    const s = createMatchSession(cfg(42), { aiTeams: [] }); // AI off so nothing intervenes
    while (!s.isFinished()) s.playNextRound();
    const sessioned = s.result();
    expect(sessioned.score).toEqual(direct.score);
    expect(sessioned.winner).toBe(direct.winner);
    expect(hashRounds(sessioned.rounds)).toBe(hashRounds(direct.rounds));
  });

  it("enforces the per-team timeout limit", () => {
    const s = createMatchSession(cfg(1), { aiTeams: [] });
    const limit = ROUND_RULES.tacticalTimeoutsPerTeam.value;
    for (let i = 0; i < limit; i++) {
      s.callTimeout("A");
      s.playNextRound(); // consume the window so A can call again next round
    }
    expect(s.state().timeoutsRemaining.A).toBe(0);
    expect(() => s.callTimeout("A")).toThrow(/no tactical timeouts/);
  });

  it("orders are only allowed during that team's timeout", () => {
    const s = createMatchSession(cfg(1), { aiTeams: [] });
    expect(() => s.setOrders("A", { strategy: "aExecute" })).toThrow(/only allowed during/);
    s.callTimeout("A");
    expect(() => s.setOrders("A", { strategy: "aExecute" })).not.toThrow();
    expect(() => s.setOrders("B", { strategy: "aExecute" })).toThrow(/only allowed during/);
  });

  it("an economy 'save' order forces the ordering team's buy to eco", () => {
    // Play a few rounds so the team has credits to otherwise buy, then order a save in a timeout.
    const s = createMatchSession(cfg(3), { aiTeams: [] });
    s.playNextRound();
    s.playNextRound();
    const atk = s.state().attacker;
    s.callTimeout(atk);
    s.setOrders(atk, { economy: "save" });
    const rec = s.playNextRound();
    expect(rec.buys[atk].tier === "eco" || rec.buys[atk].tier === "pistol").toBe(true);
    expect(rec.buys[atk].cost).toBe(0);
  });

  it("is deterministic given the same timeout/order log", () => {
    const run = () => {
      const s = createMatchSession(cfg(7), { aiTeams: [] });
      s.playNextRound();
      s.callTimeout("A");
      s.setOrders("A", { strategy: "midControl", economy: "force", durationRounds: 2 });
      while (!s.isFinished()) s.playNextRound();
      return s.result();
    };
    const a = run(); const b = run();
    expect(hashRounds(a.rounds)).toBe(hashRounds(b.rounds));
    expect(a.timeoutLog).toEqual(b.timeoutLog);
    expect(a.timeoutLog.some((e) => e.by === "human" && e.team === "A")).toBe(true);
  });

  it("AI opponent calls a timeout on a losing streak (deterministic)", () => {
    // AI drives both teams; a ≥3 loss streak should trigger at least one AI timeout in some match.
    let sawAiTimeout = false;
    for (let seed = 1; seed <= 6 && !sawAiTimeout; seed++) {
      const s = createMatchSession(cfg(seed)); // AI on (default)
      while (!s.isFinished()) s.playNextRound();
      if (s.result().timeoutLog.some((e) => e.by === "ai")) sawAiTimeout = true;
    }
    expect(sawAiTimeout).toBe(true);
  });
});
