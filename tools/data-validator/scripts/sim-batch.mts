// PROJECT V — `sim:batch` runner (PV-2 Data).
//
// Runs N full matches through @pv/match-runner, bundles every round into the SimRun contract, and
// feeds it to `sim:validate` (pv-validate-sim) for a batch report comparing the simulator against
// the real VCT baselines. Use this to snapshot the engine's behaviour and to measure PV-3 / PV-4
// improvements (e.g. the timeExpired-rate fix) against a fixed baseline.
//
// Run (tsx resolves the workspace TS packages via relative imports):
//   npx tsx tools/data-validator/scripts/sim-batch.mts --matches 20
//   (root wiring, owned by the root-config owner:  "sim:batch": "tsx tools/data-validator/scripts/sim-batch.mts")
//
// Options:
//   --matches N        number of matches to simulate (default 20); seeds are seedStart..seedStart+N-1
//   --seed-start S     first seed (default 1) — deterministic per seed (DECISION-010)
//   --map NAME         map (default Ascent)
//   --geometry own     simulate on the named map's own geometry (zone graph, roadmap, sight table);
//                      default: every map is simulated on Ascent's geometry (MatchConfig.geometry)
//   --max-rounds R     safety cap on rounds per match passed to runMatch (default: engine default 60)
//   --out FILE         SimRun bundle path (default reports/sim-batch-run.json)
//   --report PREFIX    report path prefix for sim:validate (default reports/sim-batch)
//   --era ERA          baseline era for sim:validate: "all" (default) | "patch>=9"
//   --compare FILE     a prior report JSON (e.g. docs/research/SIM_BASELINE_2026-11-18.json) to diff
//                      against — the report gains Δ-vs-baseline + improved/worsened columns
//   --no-validate      only write the SimRun bundle + print the summary; skip sim:validate
//
// Players are side-named (atk1..atk5 / def1..def5) by the round simulator, so the per-round roster
// is constant; buyTiers come from the match-runner's per-team BuyDecision for the round's attacker.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runMatch, type MatchConfig, type TeamSlot } from "../../../packages/match-runner/src/index.ts";
import { toSimGameEvents } from "../../../packages/round-simulator/src/index.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(SCRIPT_DIR, "..");       // tools/data-validator
const REPO_ROOT = resolve(TOOL_DIR, "..", "..");  // repo root

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

function resolvePath(p: string): string {
  return isAbsolute(p) ? p : join(REPO_ROOT, p);
}

/** Constant per-round roster: the round simulator names players by side (atk1..5 / def1..5). */
function rosterFor(): Record<string, "attack" | "defense"> {
  const r: Record<string, "attack" | "defense"> = {};
  for (let i = 1; i <= 5; i++) { r[`atk${i}`] = "attack"; r[`def${i}`] = "defense"; }
  return r;
}

/** Fixed sample of team pairs from game-data (labels only — the sim players are side-named). */
async function loadTeamPairs(): Promise<Array<{ id: string; name: string }>> {
  try {
    const gd = await import("../../../packages/game-data/src/index.ts");
    const teams = (gd.listSimulatableTeams?.() ?? []).map((t: { id: string; name: string }) => ({ id: t.id, name: t.name }));
    if (teams.length >= 2) return teams;
  } catch { /* fall through to synthetic labels */ }
  return Array.from({ length: 8 }, (_, i) => ({ id: `team-${i + 1}`, name: `Team ${i + 1}` }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const matches = Number(args["matches"] ?? 20);
  const seedStart = Number(args["seed-start"] ?? 1);
  const map = String(args["map"] ?? "Ascent");
  const ownGeometry = String(args["geometry"] ?? "") === "own";
  if (args["geometry"] !== undefined && !ownGeometry) { console.error('sim:batch: --geometry takes "own"'); process.exit(2); }
  const maxRounds = args["max-rounds"] !== undefined ? Number(args["max-rounds"]) : undefined;
  const outPath = resolvePath(String(args["out"] ?? "reports/sim-batch-run.json"));
  const reportPrefix = resolvePath(String(args["report"] ?? "reports/sim-batch"));
  const era = String(args["era"] ?? "all");
  const comparePath = args["compare"] !== undefined ? resolvePath(String(args["compare"])) : undefined;
  const doValidate = args["no-validate"] !== true;
  const enableAbilities = args["abilities"] === true; // --abilities: run with agent abilities on (PV-3)

  if (!Number.isFinite(matches) || matches < 1) { console.error("sim:batch: --matches must be >= 1"); process.exit(2); }
  if (outPath === `${reportPrefix}.json`) {
    console.error(`sim:batch: --out and --report would both write ${outPath}; choose distinct paths`); process.exit(2);
  }

  const teams = await loadTeamPairs();
  const pairFor = (i: number): [{ id: string; name: string }, { id: string; name: string }] =>
    [teams[(2 * i) % teams.length]!, teams[(2 * i + 1) % teams.length]!];

  const rounds: unknown[] = [];
  const reasonCounts: Record<string, number> = {};
  let attackRoundWins = 0, totalRounds = 0, pistolRounds = 0, pistolAttackWins = 0, otMatches = 0;

  console.error(`sim:batch: simulating ${matches} match(es) on ${map}${ownGeometry ? " (its own geometry)" : map.toLowerCase() === "ascent" ? "" : " (on Ascent's geometry)"}, seeds ${seedStart}..${seedStart + matches - 1}`);
  const t0 = Date.now();
  for (let i = 0; i < matches; i++) {
    const [teamA, teamB] = pairFor(i);
    const config: MatchConfig = { teamA, teamB, map, seed: seedStart + i, ...(maxRounds ? { maxRounds } : {}), ...(enableAbilities ? { enableAbilities: true } : {}), ...(ownGeometry ? { geometry: "own" as const } : {}) };
    const m = runMatch(config);
    if (m.wentToOvertime) otMatches++;
    for (const r of m.rounds) {
      const atk: TeamSlot = r.attacker;
      const def: TeamSlot = atk === "A" ? "B" : "A";
      rounds.push({
        roundNumber: r.roundNumber,
        map,
        roster: rosterFor(),
        buyTiers: { attack: r.buys[atk].tier, defense: r.buys[def].tier },
        events: toSimGameEvents({ events: r.events, winner: r.winnerSide, reason: r.reason } as never),
      });
      totalRounds++;
      reasonCounts[r.reason] = (reasonCounts[r.reason] ?? 0) + 1;
      if (r.winnerSide === "attack") attackRoundWins++;
      if (r.phase === "pistol") { pistolRounds++; if (r.winnerSide === "attack") pistolAttackWins++; }
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const bundle = {
    meta: {
      synthetic: true,
      label: `sim-batch ${matches} matches (seeds ${seedStart}..${seedStart + matches - 1}, ${map})`,
      rounds: rounds.length, matches, map, seedStart,
      generatedAt: new Date().toISOString(),
    },
    rounds,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(bundle));

  // Stdout summary (easy to paste into a baseline snapshot).
  const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
  console.error(`\nsim:batch summary (${matches} matches, ${totalRounds} rounds, ${otMatches} to OT, ${elapsed}s)`);
  console.error(`  attack round win rate : ${pct(attackRoundWins, totalRounds)}  (${attackRoundWins}/${totalRounds})`);
  console.error(`  pistol attack win rate: ${pct(pistolAttackWins, pistolRounds)}  (${pistolAttackWins}/${pistolRounds})`);
  console.error(`  round-end reasons     :`);
  for (const [k, v] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.error(`     ${k.padEnd(16)} ${v}  (${pct(v, totalRounds)})`);
  }
  console.error(`  wrote SimRun bundle   : ${outPath.replace(REPO_ROOT + "/", "")}`);

  if (!doValidate) return;
  console.error(`\nsim:batch: running sim:validate (era=${era}${comparePath ? `, compare=${comparePath.replace(REPO_ROOT + "/", "")}` : ""}) ...`);
  const res = spawnSync("node", [join(TOOL_DIR, "scripts", "sim-validate.mjs"),
    "--logs", outPath, "--era", era, "--out", reportPrefix, "--stdout",
    ...(comparePath ? ["--compare", comparePath] : [])], { cwd: REPO_ROOT, stdio: "inherit" });
  process.exit(res.status ?? 1);
}

main().catch((e) => { console.error("sim:batch failed:", e); process.exit(1); });
