#!/usr/bin/env -S npx tsx
/**
 * CLI: `pnpm sim:series --teamA <id> --teamB <id> [--format bo1|bo3|bo5] [--seed N]
 *                       [--analystA 0..1] [--analystB 0..1] [--no-mastery]`
 *
 * Runs a whole series (AI veto for both teams) and prints the veto, each map and the result.
 * Maps other than Ascent are simulated on the Ascent geometry with their own mastery applied.
 */
import { renderSeriesSummary, resolveTeamRef, runSeries, type SeriesFormatId } from "./index.js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    out[a.slice(2)] = next && !next.startsWith("--") ? argv[++i]! : "true";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const format = (args.format ?? "bo3") as SeriesFormatId;
const result = runSeries({
  teamA: { ...resolveTeamRef(args.teamA ?? "624"), ...(args.analystA ? { staff: { analyst: Number(args.analystA) } } : {}) },
  teamB: { ...resolveTeamRef(args.teamB ?? "7386"), ...(args.analystB ? { staff: { analyst: Number(args.analystB) } } : {}) },
  format,
  seed: Number(args.seed ?? "1"),
  ...(args["no-mastery"] ? { mastery: false } : {}),
});
console.log(renderSeriesSummary(result));
for (const t of ["A", "B"] as const) {
  const name = t === "A" ? result.config.teamA.name : result.config.teamB.name;
  const m = result.preparation.mastery[t];
  console.log(`${name} mastery: ${result.preparation.pool.map((map) => `${map} ${m[map]!.value.toFixed(2)}±${m[map]!.uncertainty.toFixed(2)}`).join(", ")}`);
}
