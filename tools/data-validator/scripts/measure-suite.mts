// PROJECT V — the regular measurement suite (one command).
//
//   npx tsx tools/data-validator/scripts/measure-suite.mts
//
// Runs, strictly one batch at a time and each through the machine's heavy-run lock:
//   default      160 matches, seeds 1..160, Ascent           (the judged baseline condition)
//   seed161      160 matches, seeds 161..320                 (unseen seeds: is a result seed-specific?)
//   abilities    160 matches, agent abilities on
//   map-<id>     60 matches on each map's OWN geometry       (every map in the spatial registry)
// then writes ONE comparison table against the previous comparable run:
//   <out-dir>/<run-id>/SUITE.md        the table (judged metrics, report-only metrics, verdict changes)
//   <out-dir>/<run-id>/suite.json      everything as data            comparison.csv   every row
//   <out-dir>/<run-id>/<batch>.{run.json,json,md,engine.json,log}    per-batch output — distinct paths
//
// Options:
//   --matches N        matches for the three Ascent batches (default 160)
//   --map-matches M    matches per own-geometry map batch (default 60)
//   --maps a,b,c       map ids for the own-geometry batches (default: every map in the registry)
//   --only id,id       run only these batches (default, seed161, abilities, map-<id>)
//   --out-dir DIR      where runs are kept (default reports/suite)
//   --run-id ID        directory name of this run (default: UTC timestamp)
//   --compare DIR      compare with this earlier run directory; "none" = no comparison
//                      (default: the most recent earlier run with the same match counts)
//   --lock PATH        heavy-run lock script (default: $PV_HEAVY_RUN, else the project's shared one)
//   --no-lock          run without the lock — only for a machine where nothing else heavy runs
//   --python BIN       Python interpreter for sim:validate (default: $PYTHON or python3)
//   --plan             print the batches and their commands as JSON and exit (runs nothing)
//
// The lock: every batch is started as `<lock> "<label>" -- npx tsx sim-batch.mts …`, so it queues
// behind any other heavy job (another session's batch, an e2e window) and releases the lock when it
// ends; the next batch then queues again. Nothing in this suite runs in parallel.
//
// Exit codes: 0 every batch ran (judged metrics may fail — that is the report's job, not an error) ·
// 2 usage error · 3 the Python environment is broken (checked before anything is simulated) ·
// 4 at least one batch did not finish (the table marks it; the others are still reported).

import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MAPS, MAP_IDS } from "../../../packages/spatial-engine/src/maps.ts";
// @ts-expect-error — plain .mjs helper shared with sim-validate.mjs (no type declarations)
import { checkPythonEnv, formatEnvError, resolvePython, ENV_ERROR_EXIT } from "./python-env.mjs";
import {
  DEFAULT_MAP_MATCHES, DEFAULT_MATCHES, batchCommand, batchPaths, headlineValues, pickPrevious, planSuite,
  renderComparisonCsv, renderSuiteMarkdown, type BatchResult, type SuiteRun,
} from "./suite-lib.mts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(TOOL_DIR, "..", "..");
const SIM_BATCH = join(SCRIPT_DIR, "sim-batch.mts");
/** The shared lock script of this project's development machine (see docs/TEST_PLAN.md); override with $PV_HEAVY_RUN / --lock. */
const DEFAULT_LOCK = "/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh";
const BATCH_ERROR_EXIT = 4;

type Args = Record<string, string | boolean>;
function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) usage(`unexpected argument: ${a}`);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else out[a.slice(2)] = argv[++i]!;
  }
  return out;
}
function usage(msg: string): never {
  console.error(`measure-suite: ${msg}`);
  console.error("See the header of tools/data-validator/scripts/measure-suite.mts for the options.");
  process.exit(2);
}
const abs = (p: string) => (isAbsolute(p) ? p : join(REPO_ROOT, p));
const rel = (p: string) => (p.startsWith(REPO_ROOT + "/") ? p.slice(REPO_ROOT.length + 1) : p);

function git(args: string[]): string | null {
  const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function readJson<T>(path: string): T | null {
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return null; }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set(["matches", "map-matches", "maps", "only", "out-dir", "run-id", "compare", "lock", "no-lock", "python", "plan"]);
  for (const k of Object.keys(args)) if (!known.has(k)) usage(`unknown option --${k}`);
  const num = (k: string, d: number) => {
    const v = args[k] === undefined ? d : Number(args[k]);
    if (!Number.isInteger(v) || v < 1) usage(`--${k} must be a whole number >= 1`);
    return v;
  };
  const matches = num("matches", DEFAULT_MATCHES);
  const mapMatches = num("map-matches", DEFAULT_MAP_MATCHES);
  const mapIds = typeof args["maps"] === "string" ? args["maps"].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : [...MAP_IDS];
  for (const id of mapIds) if (!(MAP_IDS as readonly string[]).includes(id)) usage(`unknown map "${id}" (known: ${MAP_IDS.join(", ")})`);
  const maps = mapIds.map((id) => ({ id, displayName: MAPS[id as keyof typeof MAPS].displayName }));
  const python = typeof args["python"] === "string" ? args["python"] : undefined;

  let batches;
  try {
    batches = planSuite({ matches, mapMatches, maps, python, only: typeof args["only"] === "string" ? args["only"].split(",").map((s) => s.trim()).filter(Boolean) : undefined });
  } catch (e) { usage((e as Error).message); }

  const outDir = abs(typeof args["out-dir"] === "string" ? args["out-dir"] : "reports/suite");
  const startedAt = new Date();
  const runId = typeof args["run-id"] === "string" ? args["run-id"] : startedAt.toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  if (!/^[A-Za-z0-9._-]+$/.test(runId)) usage("--run-id may contain only letters, digits, '.', '_' and '-'");
  const runDir = join(outDir, runId);

  const lock = args["no-lock"] === true ? null : typeof args["lock"] === "string" ? abs(args["lock"]) : process.env.PV_HEAVY_RUN ?? DEFAULT_LOCK;

  if (args["plan"] === true) {
    process.stdout.write(JSON.stringify({
      runId, runDir: rel(runDir), lock, matches, mapMatches,
      batches: batches.map((b) => ({ ...b, ...batchPaths(rel(runDir), b.id), command: batchCommand(b, rel(runDir), rel(SIM_BATCH), lock, runId) })),
    }, null, 2) + "\n");
    return;
  }

  if (lock && !existsSync(lock)) {
    usage(`heavy-run lock script not found: ${lock}\n  Heavy jobs on this project run one at a time through that script. Set --lock <path> or PV_HEAVY_RUN=<path>,\n  or pass --no-lock if nothing else heavy can be running on this machine.`);
  }
  if (existsSync(runDir) && readdirSync(runDir).length > 0) usage(`run directory already exists and is not empty: ${rel(runDir)} (choose another --run-id)`);

  // Fail early: the whole suite takes a long time, this check a fraction of a second.
  const pyEnv = checkPythonEnv(resolvePython(python), TOOL_DIR);
  if (!pyEnv.ok) { console.error(formatEnvError(pyEnv, "measure-suite")); process.exit(ENV_ERROR_EXIT); }

  mkdirSync(runDir, { recursive: true });
  console.error(`measure-suite: run ${runId} → ${rel(runDir)}/  (${batches.length} batches, one at a time${lock ? `, through ${lock}` : ", NO lock"})`);

  const results: BatchResult[] = [];
  let aborted: string | null = null;
  for (const [i, b] of batches.entries()) {
    const paths = batchPaths(runDir, b.id);
    if (aborted) { results.push({ id: b.id, label: b.label, status: "skipped", exitCode: null, seconds: null, matches: b.matches, rounds: null, judged: null, headlines: headlineValues([]), error: aborted }); continue; }
    const cmd = batchCommand(b, runDir, SIM_BATCH, lock, runId);
    console.error(`measure-suite: [${i + 1}/${batches.length}] ${b.id} — ${b.label}${lock ? " (waiting for the lock if another heavy job is running)" : ""}`);
    const log = openSync(paths.log, "w");
    const t0 = Date.now();
    const res = spawnSync(cmd[0]!, cmd.slice(1), { cwd: REPO_ROOT, stdio: ["ignore", log, log] });
    closeSync(log);
    const seconds = (Date.now() - t0) / 1000;
    const report = readJson<{ summary?: { passed: number; judged: number }; metrics?: never[]; simMeta?: { rounds?: number } }>(`${paths.report}.json`);
    // sim:batch exits 0 (all judged pass) or 1 (a judged metric fails) once the report is written.
    const ran = (res.status === 0 || res.status === 1) && report !== null && Array.isArray(report.metrics);
    if (ran) {
      results.push({
        id: b.id, label: b.label, status: "ok", exitCode: res.status, seconds, matches: b.matches,
        rounds: report!.simMeta?.rounds ?? null,
        judged: report!.summary ? { passed: report!.summary.passed, judged: report!.summary.judged } : null,
        headlines: headlineValues(report!.metrics as never),
      });
      console.error(`measure-suite:        done in ${Math.round(seconds)}s — ${report!.summary?.passed}/${report!.summary?.judged} judged metrics pass`);
    } else {
      const tail = (readFileSync(paths.log, "utf8").trim().split("\n").filter((l) => l.trim()).pop() ?? "").slice(0, 200);
      const why = res.error ? res.error.message : `exit ${res.status ?? `signal ${res.signal}`}${tail ? ` — ${tail}` : ""}`;
      results.push({ id: b.id, label: b.label, status: "error", exitCode: res.status, seconds, matches: b.matches, rounds: null, judged: null, headlines: headlineValues([]), error: why });
      console.error(`measure-suite:        FAILED (${why}); see ${rel(paths.log)}`);
      // A broken Python environment fails every batch the same way: stop instead of simulating for nothing.
      if (res.status === ENV_ERROR_EXIT) aborted = "skipped: the Python environment broke during the run";
    }
  }

  const now: SuiteRun = {
    runId, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    commit: git(["rev-parse", "--short", "HEAD"]), dirty: (git(["status", "--porcelain", "--untracked-files=no"]) ?? "") !== "",
    config: { matches, mapMatches }, batches: results,
  };

  let previous: SuiteRun | null = null;
  if (args["compare"] !== "none") {
    if (typeof args["compare"] === "string") {
      previous = readJson<SuiteRun>(join(abs(args["compare"]), "suite.json"));
      if (!previous) console.error(`measure-suite: WARNING — no suite.json in ${args["compare"]}; writing the table without a comparison`);
    } else if (existsSync(outDir)) {
      const earlier = readdirSync(outDir).map((d) => readJson<SuiteRun>(join(outDir, d, "suite.json"))).filter((r): r is SuiteRun => r !== null);
      previous = pickPrevious(now, earlier);
    }
  }

  writeFileSync(join(runDir, "suite.json"), JSON.stringify({ ...now, comparedWith: previous?.runId ?? null }, null, 2) + "\n");
  writeFileSync(join(runDir, "comparison.csv"), renderComparisonCsv(now, previous));
  const md = renderSuiteMarkdown(now, previous);
  writeFileSync(join(runDir, "SUITE.md"), md);
  process.stdout.write(md);
  console.error(`measure-suite: wrote ${rel(join(runDir, "SUITE.md"))}${previous ? ` (compared with ${previous.runId})` : " (no earlier comparable run)"}`);
  process.exit(results.some((r) => r.status !== "ok") ? BATCH_ERROR_EXIT : 0);
}

main();
