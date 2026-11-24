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
//   --mid-control      turn mid control on (MatchConfig.midControl; default off): the "on" arm of its measurement
//   --geometry own     simulate on the named map's own geometry (zone graph, roadmap, sight table);
//                      default: every map is simulated on Ascent's geometry (MatchConfig.geometry)
//   --max-rounds R     safety cap on rounds per match passed to runMatch (default: engine default 60)
//   --out FILE         SimRun bundle path (default reports/sim-batch-run.json)
//   --report PREFIX    report path prefix for sim:validate (default reports/sim-batch)
//   --era ERA          baseline era for sim:validate: "all" (default) | "patch>=9"
//   --compare FILE     a prior report JSON (e.g. docs/research/SIM_BASELINE_2026-11-18.json) to diff
//                      against — the report gains Δ-vs-baseline + improved/worsened columns
//   --no-validate      only write the SimRun bundle + print the summary; skip sim:validate
//   --tuning JSON      MatchConfig.tuning for every match (pre-match engine options, e.g. '{"damageCarryover":0.5}')
//   --sound            sound detail on (SimConfig.soundDetail: landings off drops, gunfire masking)
//   --gaze             gaze model on (SimConfig.gaze: turn-rate gaze, peek points, Fitts aim time)
//   --no-buy-phase     players start where the match sets them (no buy-phase movement)
//   --style            per-player movement style on, every part (default: buy-phase script only)
//   --no-style         every player moves the executor's one way (no per-player movement style)
//   --style-off LIST   switch parts of the movement style off: lanes,spacing,routes,checks,lurk
//   --abilities        agent abilities on (default off — as the desktop game plays today)
//   --information      information layer on (MatchConfig.informationLayer; default off)
//   --teams-only       print the paired teams' first-five combat skills as JSON and exit (the
//                      roster check in tests/test_sim_batch_runner.py uses it)
//   --mirror           both teams league-average players (every attribute and trait at the
//                      fallback 0.6) instead of real rosters. Every batch before 2026-11-23 ran this
//                      way by accident (team ids were read as `t.id`, which game-data does not have),
//                      so use --mirror to reproduce those older numbers.
//
// Teams: real game-data rosters (`simulatableTeamRefs`, 46 teams), paired in a fixed order —
// match i plays teams[2i mod n] vs teams[2i+1 mod n]. The MatchConfig is otherwise what the desktop
// Match Day sends with default options (no tuning, abilities off, opponent memory on).
//
// Report-only engine metrics (engine-metrics.mts: first kill, flawless, force buys, round duration,
// site arrival spread, path diversity, body overlap, crowd counters, outcome by strength gap) are
// written next to the report as <report>.engine.json and appended to <report>.md. They are never
// judged and never change the exit code.
//
// Players are side-named (atk1..atk5 / def1..def5) by the round simulator, so the per-round roster
// is constant; buyTiers come from the match-runner's per-team BuyDecision for the round's attacker.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rosterSkills, runMatch, simulatableTeamRefs, type MatchConfig, type TeamRef, type TeamSlot } from "../../../packages/match-runner/src/index.ts";
import { toSimGameEvents } from "../../../packages/round-simulator/src/index.ts";
import { EngineMetrics, renderEngineMetrics } from "./engine-metrics.mts";

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

/**
 * The teams a batch plays. Real rosters by default; `mirror` gives two ids game-data does not know,
 * which the match-runner plays with league-average players (the pre-2026-11-23 batch condition).
 */
function batchTeams(mirror: boolean): TeamRef[] {
  // The id is the literal string the old batches' `${undefined}` produced: the match id
  // ("undefined-vs-undefined") seeds every round, so --mirror reproduces those runs exactly.
  if (mirror) return [{ id: "undefined", name: "Mirror A" }, { id: "undefined", name: "Mirror B" }];
  const teams = simulatableTeamRefs();
  if (teams.length < 2) throw new Error("sim:batch: game-data has fewer than two simulatable teams");
  return teams;
}

/** Mean combat skill of a team's first five (what the round fields). */
function strengthOf(team: TeamRef): number {
  const five = rosterSkills(team.id, 5);
  const vals = five.flatMap((s) => Object.values(s) as number[]);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Real rosters must actually reach the engine: if every player of every team comes out at the
 * league-average fallback, the team ids are not being resolved (the pre-2026-11-23 bug). Fail loudly.
 */
function assertRealRosters(teams: readonly TeamRef[]): void {
  const values = new Set<number>();
  for (const t of teams) for (const s of rosterSkills(t.id, 5)) for (const v of Object.values(s) as number[]) values.add(v);
  if (values.size <= 1) throw new Error(`sim:batch: real-roster mode but every rating is ${[...values][0]} — team ids are not resolving to rosters`);
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
  const mirror = args["mirror"] === true;
  // --belief-beta B --belief-tau T: the teams' round-win belief curve (economy option; default sim fit).
  // --economy '{"ecoSidearms":true}': any other economy options (JSON), merged under the belief flags.
  const economyJson = args["economy"] !== undefined ? JSON.parse(String(args["economy"])) as Record<string, unknown> : {};
  const economy = args["belief-beta"] !== undefined || args["economy"] !== undefined
    ? { ...economyJson, ...(args["belief-beta"] !== undefined ? { winBelief: { beta: Number(args["belief-beta"]), tauCredits: Number(args["belief-tau"] ?? 10000) } } : {}) } : undefined;
  const tuning = typeof args["tuning"] === "string" ? JSON.parse(args["tuning"]) : undefined;

  if (!Number.isFinite(matches) || matches < 1) { console.error("sim:batch: --matches must be >= 1"); process.exit(2); }
  if (outPath === `${reportPrefix}.json`) {
    console.error(`sim:batch: --out and --report would both write ${outPath}; choose distinct paths`); process.exit(2);
  }

  const teams = batchTeams(mirror);
  if (!mirror) assertRealRosters(teams);
  if (args["teams-only"] === true) {
    process.stdout.write(JSON.stringify({ mirror, teams: teams.map((t) => ({ id: t.id, name: t.name, firstFive: rosterSkills(t.id, 5) })) }) + "\n");
    return;
  }
  const rosters = mirror ? "league-average mirror" : `real rosters (${teams.length} teams)`;
  const pairFor = (i: number): [TeamRef, TeamRef] =>
    [teams[(2 * i) % teams.length]!, teams[(2 * i + 1) % teams.length]!];

  const rounds: unknown[] = [];
  const reasonCounts: Record<string, number> = {};
  let attackRoundWins = 0, totalRounds = 0, pistolRounds = 0, pistolAttackWins = 0, otMatches = 0;
  const metrics = new EngineMetrics();

  console.error(`sim:batch: simulating ${matches} match(es) on ${map}${ownGeometry ? " (its own geometry)" : map.toLowerCase() === "ascent" ? "" : " (on Ascent's geometry)"}, seeds ${seedStart}..${seedStart + matches - 1}, ${rosters}${enableAbilities ? ", abilities on" : ""}`);
  const t0 = Date.now();
  for (let i = 0; i < matches; i++) {
    const [teamA, teamB] = pairFor(i);
    const config: MatchConfig = { teamA, teamB, map, seed: seedStart + i, collectStats: true, ...(args["gaze"] === true ? { gaze: true } : {}), ...(args["mid-control"] === true ? { midControl: true } : {}), ...(args["sound"] === true ? { soundDetail: true } : {}), ...(args["no-buy-phase"] === true ? { buyPhase: false } : {}), ...(args["style"] === true ? { movementStyle: true } : args["no-style"] === true ? { movementStyle: false } : args["style-off"] ? { movementStyle: Object.fromEntries(String(args["style-off"]).split(",").map((k) => [k.trim(), false])) } : {}), ...(tuning ? { tuning } : {}), ...(maxRounds ? { maxRounds } : {}), ...(enableAbilities ? { enableAbilities: true } : {}), ...(ownGeometry ? { geometry: "own" as const } : {}), ...(economy ? { economy } : {}), ...(args["weapon-modes"] === true ? { weaponModes: true } : {}), ...(args["information"] === true ? { informationLayer: true } : {}) };
    const m = runMatch(config);
    if (m.wentToOvertime) otMatches++;
    const strength = { A: strengthOf(teamA), B: strengthOf(teamB) };
    for (const r of m.rounds) {
      const atk: TeamSlot = r.attacker;
      const def: TeamSlot = atk === "A" ? "B" : "A";
      metrics.add({ record: r, attackStrength: strength[atk], defenseStrength: strength[def] });
      rounds.push({
        roundNumber: r.roundNumber,
        map,
        roster: rosterFor(),
        match: i,
        // VCT buy tiers from the team loadout value (eco < 5000, semi 5000–20000, full >= 20000;
        // pistol rounds stay "pistol"), the definition the real economy-matchup table uses.
        buyTiers: { attack: r.buys[atk].vctTier, defense: r.buys[def].vctTier },
        // The team's own call (pistol / full / half / force / eco / bonus) and what it bought.
        plans: { attack: r.buys[atk].tier, defense: r.buys[def].tier },
        econ: {
          attack: { value: r.buys[atk].loadoutValue, bank: r.buys[atk].players.reduce((s, b) => s + b.creditsAfter, 0), drops: r.buys[atk].drops, pickups: r.pickups.filter((p) => p.team === atk).length, roundPickups: r.events.filter((e) => (e.kind as string) === "weaponPickup" && String(e.actor).startsWith("atk")).length },
          defense: { value: r.buys[def].loadoutValue, bank: r.buys[def].players.reduce((s, b) => s + b.creditsAfter, 0), drops: r.buys[def].drops, pickups: r.pickups.filter((p) => p.team === def).length, roundPickups: r.events.filter((e) => (e.kind as string) === "weaponPickup" && String(e.actor).startsWith("def")).length },
        },
        events: toSimGameEvents({ events: r.events, winner: r.winnerSide, reason: r.reason } as never),
        // Mid control (report-only): each side's decision and own estimate, the attack's call, and the true record.
        ...(r.mid || r.decisions.plans[atk]?.mid || r.decisions.plans[def]?.mid ? { mid: {
          call: r.decisions.plans[atk]?.opening ?? null,
          attack: r.decisions.plans[atk]?.mid ?? null,
          defense: r.decisions.plans[def]?.mid ?? null,
          truth: r.mid ? { final: r.mid.final, heldMs: r.mid.heldMs, firstHeld: r.mid.firstHeld } : null,
        } } : {}),
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
      label: `sim-batch ${matches} matches (seeds ${seedStart}..${seedStart + matches - 1}, ${map}, ${rosters}${enableAbilities ? ", abilities on" : ""}${tuning ? `, tuning ${JSON.stringify(tuning)}` : ""}${args["gaze"] === true ? ", gaze model" : ""}${args["sound"] === true ? ", sound detail" : ""}${args["no-buy-phase"] === true ? ", no buy phase" : ""}${args["style"] === true ? ", movement style" : ""}${args["no-style"] === true ? ", no movement style" : ""}${args["style-off"] ? `, style off: ${args["style-off"]}` : ""})`,
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

  const engine = metrics.report();
  const engineMd = renderEngineMetrics(engine);
  mkdirSync(dirname(reportPrefix), { recursive: true });
  writeFileSync(`${reportPrefix}.engine.json`, JSON.stringify(engine, null, 2));
  console.error(engineMd);
  const appendEngine = () => { if (existsSync(`${reportPrefix}.md`)) appendFileSync(`${reportPrefix}.md`, engineMd); };

  if (!doValidate) return;
  console.error(`\nsim:batch: running sim:validate (era=${era}${comparePath ? `, compare=${comparePath.replace(REPO_ROOT + "/", "")}` : ""}) ...`);
  const res = spawnSync("node", [join(TOOL_DIR, "scripts", "sim-validate.mjs"),
    "--logs", outPath, "--era", era, "--out", reportPrefix, "--stdout",
    ...(comparePath ? ["--compare", comparePath] : [])], { cwd: REPO_ROOT, stdio: "inherit" });
  appendEngine();
  process.exit(res.status ?? 1);
}

main().catch((e) => { console.error("sim:batch failed:", e); process.exit(1); });
