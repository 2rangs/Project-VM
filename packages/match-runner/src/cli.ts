#!/usr/bin/env -S npx tsx
/**
 * CLI: `pnpm sim:match --teamA <id> --teamB <id> --map ascent --seed N`
 *
 * Runs a full match and writes, next to each other under --out (default ./match-out):
 *   - summary.txt   human-readable score + per-round summary
 *   - events.json   per-round EventLog (round-simulator SimEvent[])
 *   - replay.json   per-round PV-6 replay-engine bridge logs
 *   - trace.json    compact per-round decision trace
 * It also prints the summary to stdout.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { runMatch, renderMatchSummary, renderDecisionTrace, resolveTeamRef, type MatchConfig } from "./index.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const teamAId = args.teamA ?? "team-a";
  const teamBId = args.teamB ?? "team-b";
  // Resolve real team names from @pv/game-data (falls back to the id); --nameA/--nameB override.
  const refA = resolveTeamRef(teamAId);
  const refB = resolveTeamRef(teamBId);
  const config: MatchConfig = {
    teamA: { id: teamAId, name: args.nameA ?? refA.name },
    teamB: { id: teamBId, name: args.nameB ?? refB.name },
    map: args.map ?? "ascent",
    seed: Number(args.seed ?? "1"),
    ...(args.maxRounds ? { maxRounds: Number(args.maxRounds) } : {}),
  };

  const verbose = args.verbose === "true" || args.progress === "true";
  const result = runMatch(config, {
    onRound: verbose
      ? (r, score) => console.error(`  … R${r.roundNumber} ${r.winner} (${r.reason}) → ${score.A}-${score.B}`)
      : undefined,
  });
  const summary = renderMatchSummary(result);
  console.log(summary);

  const outDir = resolve(process.cwd(), args.out ?? "match-out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "summary.txt"), summary + "\n", "utf8");
  writeFileSync(
    resolve(outDir, "events.json"),
    JSON.stringify(result.rounds.map((r) => ({ round: r.roundNumber, events: r.events })), null, 2),
    "utf8",
  );
  writeFileSync(
    resolve(outDir, "replay.json"),
    JSON.stringify(result.rounds.map((r) => ({ round: r.roundNumber, replay: r.replay })), null, 2),
    "utf8",
  );
  writeFileSync(resolve(outDir, "trace.json"), JSON.stringify(renderDecisionTrace(result), null, 2), "utf8");
  console.log(`\nWrote summary.txt, events.json, replay.json, trace.json to ${outDir}`);
}

main();
