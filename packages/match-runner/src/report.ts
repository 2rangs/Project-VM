/**
 * Human-readable match report + a compact decision trace. No I/O here — returns strings /
 * plain objects the CLI prints or writes.
 */
import type { MatchResult, RoundRecord, TeamSlot } from "./match.js";

function teamName(result: MatchResult, slot: TeamSlot): string {
  return slot === "A" ? result.config.teamA.name : result.config.teamB.name;
}

function roundLine(result: MatchResult, r: RoundRecord): string {
  const atkName = teamName(result, r.attacker);
  const winName = teamName(result, r.winner);
  const tag = r.phase === "pistol" ? "PISTOL" : r.phase === "overtime" ? "OT" : "";
  const buyA = `${r.buys.A.weapon}(${r.buys.A.tier})`;
  const buyB = `${r.buys.B.weapon}(${r.buys.B.tier})`;
  const plant = r.planted ? " planted" : "";
  return (
    `R${String(r.roundNumber).padStart(2, " ")} ${tag.padEnd(6, " ")} ` +
    `atk=${atkName.padEnd(10)} win=${winName.padEnd(10)} ` +
    `[${r.reason}${plant}] kills A:${r.kills.A} B:${r.kills.B} ` +
    `buy A:${buyA} B:${buyB} ` +
    `$A:${r.economy.A.credits} $B:${r.economy.B.credits} ` +
    `score ${r.score.A}-${r.score.B}`
  );
}

/** Full text summary: header, per-round lines, final score, opponent memory. */
export function renderMatchSummary(result: MatchResult): string {
  const a = result.config.teamA;
  const b = result.config.teamB;
  const lines: string[] = [];
  lines.push(`=== MATCH: ${a.name} (A) vs ${b.name} (B) — map ${result.config.map}, seed ${result.config.seed} ===`);
  lines.push("");
  for (const r of result.rounds) lines.push(roundLine(result, r));
  lines.push("");
  const winName = result.winner === "A" ? a.name : b.name;
  lines.push(`FINAL: ${a.name} ${result.score.A} — ${result.score.B} ${b.name}  →  ${winName} wins${result.wentToOvertime ? " (OT)" : ""}`);
  lines.push("");
  lines.push("Opponent memory (IGL):");
  lines.push(`  ${a.name} vs ${b.name}: pistolWon=${result.memory.A.pistolWon} wins=${result.memory.A.roundsWon} losses=${result.memory.A.roundsLost}`);
  lines.push(`  ${b.name} vs ${a.name}: pistolWon=${result.memory.B.pistolWon} wins=${result.memory.B.roundsWon} losses=${result.memory.B.roundsLost}`);
  return lines.join("\n");
}

/** A compact per-round decision trace (round → side buys, outcome, reason). */
export function renderDecisionTrace(result: MatchResult): Array<Record<string, unknown>> {
  return result.rounds.map((r) => ({
    round: r.roundNumber,
    phase: r.phase,
    attacker: r.attacker,
    buyA: r.buys.A,
    buyB: r.buys.B,
    winner: r.winner,
    winnerSide: r.winnerSide,
    reason: r.reason,
    planted: r.planted,
    kills: r.kills,
    score: r.score,
    creditsA: r.economy.A.credits,
    creditsB: r.economy.B.credits,
    ultA: r.economy.A.ultPoints,
    ultB: r.economy.B.ultPoints,
  }));
}
