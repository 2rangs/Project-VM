#!/usr/bin/env node
// PROJECT V — `sim:validate` runner (PV-2 Data).
//
// Bridges the Match Runner's export (round-simulator `toValidationRun` → a SimRun bundle) to PV-2's
// Python validation harness (`pv-validate-sim`), and writes a Markdown + JSON report comparing the
// simulated match against the real VCT baselines in datasets/derived/priors + VALIDATION_BASELINES.md.
//
// Intended entry: `pnpm sim:validate -- --logs <sim_run.json>` (root script delegates here), or run
// directly: `node tools/data-validator/scripts/sim-validate.mjs --logs <sim_run.json>`.
//
// The SimRun shape is the stable contract (round-simulator `SimRun`/`toValidationRun`):
//   { meta: { synthetic, label, rounds }, rounds: [ { roundNumber, map, roster, buyTiers, events[] } ] }
//
// Options:
//   --logs <file>     SimRun JSON from the Match Runner. "-" reads stdin. (required unless --example)
//   --example         Validate the shipped good-run fixture instead (proves the pipeline end-to-end).
//   --era <era>       Baseline era: "all" (default, PV-2 recommendation) or "patch>=9".
//                     Overridable via env PV_SIM_ERA. CLI flag wins over env.
//   --scope <scope>   "ascent" (default) or "all_maps".
//   --priors <dir>    Priors dir (default: datasets/derived/priors).
//   --out <prefix>    Report path prefix (default: reports/sim-validation → .json + .md).
//   --stdout          Print the Markdown report to stdout as well.
//   --python <bin>    Python interpreter (default: $PYTHON or python3).
//
// Exit codes: 0 all judged metrics pass · 1 a judged metric fails (so CI can gate on it) ·
// 2 usage error · 3 the Python environment or the harness is broken (nothing was judged; the
// environment is checked BEFORE anything else runs — see python-env.mjs).

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { checkPythonEnv, formatEnvError, harnessPythonPath, resolvePython, ENV_ERROR_EXIT } from "./python-env.mjs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = resolve(SCRIPT_DIR, "..");            // tools/data-validator
const REPO_ROOT = resolve(TOOL_DIR, "..", "..");        // repo root
const VALID_ERAS = new Set(["all", "patch>=9"]);
const VALID_SCOPES = new Set(["ascent", "all_maps"]);

function parseArgs(argv) {
  const out = { era: null, scope: "ascent", priors: null, logs: null, outPrefix: null,
                example: false, stdout: false, python: null, compare: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) { fail(`missing value for ${a}`); }
      return v;
    };
    switch (a) {
      case "--logs": out.logs = next(); break;
      case "--era": out.era = next(); break;
      case "--scope": out.scope = next(); break;
      case "--priors": out.priors = next(); break;
      case "--compare": out.compare = next(); break;
      case "--out": out.outPrefix = next(); break;
      case "--python": out.python = next(); break;
      case "--example": out.example = true; break;
      case "--stdout": out.stdout = true; break;
      case "-h": case "--help": printHelp(); process.exit(0); break;
      default: fail(`unknown argument: ${a}`);
    }
  }
  return out;
}

function fail(msg) {
  console.error(`sim:validate: ${msg}`);
  console.error(`Try: node tools/data-validator/scripts/sim-validate.mjs --help`);
  process.exit(2);
}

function printHelp() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8")
    .split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
}

function resolvePath(p, fallback) {
  const v = p ?? fallback;
  return isAbsolute(v) ? v : join(REPO_ROOT, v);
}

// Validate the SimRun shape before handing it to Python, so errors are friendly and specific.
function assertSimRun(obj, source) {
  const bad = (m) => fail(`${source} is not a valid SimRun: ${m}`);
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) bad("top level must be an object");
  if (typeof obj.meta !== "object" || obj.meta === null) bad("missing `meta` object");
  if (!Array.isArray(obj.rounds)) bad("missing `rounds` array");
  if (obj.rounds.length === 0) bad("`rounds` is empty — nothing to validate");
  obj.rounds.forEach((r, i) => {
    if (typeof r !== "object" || r === null) bad(`rounds[${i}] is not an object`);
    if (!Array.isArray(r.events)) bad(`rounds[${i}].events must be an array`);
    if (typeof r.roster !== "object" || r.roster === null) bad(`rounds[${i}].roster must be an object`);
  });
  if (obj.meta.synthetic === false) {
    // The harness compares against real baselines; a run flagged real would be a provenance error.
    console.error("sim:validate: WARNING — meta.synthetic is false; the harness expects simulated runs.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  // Fail early, and clearly, when the Python side cannot run at all.
  const python = resolvePython(args.python);
  const pyEnv = checkPythonEnv(python, TOOL_DIR);
  if (!pyEnv.ok) { console.error(formatEnvError(pyEnv)); process.exit(ENV_ERROR_EXIT); }

  // era: CLI flag > env PV_SIM_ERA > default "all" (PV-2 recommendation: era-stable, tighter CIs).
  const era = args.era ?? process.env.PV_SIM_ERA ?? "all";
  if (!VALID_ERAS.has(era)) fail(`invalid --era ${JSON.stringify(era)} (expected: ${[...VALID_ERAS].join(", ")})`);
  if (!VALID_SCOPES.has(args.scope)) fail(`invalid --scope ${JSON.stringify(args.scope)}`);

  // Resolve the SimRun input.
  let logsPath;
  if (args.example) {
    logsPath = join(TOOL_DIR, "examples", "sim_run_good.json");
    if (!existsSync(logsPath)) fail(`example fixture not found at ${logsPath}`);
  } else if (!args.logs) {
    fail("no input: pass --logs <sim_run.json> (or --logs - for stdin, or --example)");
  } else if (args.logs === "-") {
    const raw = readFileSync(0, "utf8");
    assertSimRun(JSON.parse(raw), "stdin");
    // Spill to the OS temp dir (not the repo) so a piped run leaves no stray files behind.
    logsPath = join(tmpdir(), `pv-sim-run-${process.pid}.json`);
    writeFileSync(logsPath, raw);
  } else {
    logsPath = resolvePath(args.logs);
    if (!existsSync(logsPath)) fail(`--logs file not found: ${logsPath}`);
    assertSimRun(JSON.parse(readFileSync(logsPath, "utf8")), logsPath);
  }

  const priorsDir = resolvePath(args.priors, "datasets/derived/priors");
  if (!existsSync(priorsDir)) fail(`priors dir not found: ${priorsDir}`);
  const outPrefix = resolvePath(args.outPrefix, "reports/sim-validation");
  mkdirSync(dirname(outPrefix), { recursive: true });

  let comparePath = null;
  if (args.compare) {
    comparePath = resolvePath(args.compare);
    if (!existsSync(comparePath)) fail(`--compare file not found: ${comparePath}`);
  }
  const pyArgs = ["-m", "pv_data_validator.sim_cli",
    "--logs", logsPath, "--priors", priorsDir,
    "--scope", args.scope, "--era", era, "--out", outPrefix,
    ...(comparePath ? ["--compare", comparePath] : [])];

  console.error(`sim:validate: era=${era} scope=${args.scope} priors=${rel(priorsDir)}`);
  console.error(`sim:validate: validating ${rel(logsPath)} → ${rel(outPrefix)}.{json,md}`);

  const reportJson = `${outPrefix}.json`;
  const startedAt = Date.now();
  const res = spawnSync(python, pyArgs, {
    cwd: REPO_ROOT,
    stdio: args.stdout ? "inherit" : ["inherit", "pipe", "inherit"],
    env: { ...process.env, PYTHONPATH: harnessPythonPath(TOOL_DIR) },
  });

  if (res.error) {
    console.error(`sim:validate: failed to run the validator with ${python}: ${res.error.message}`);
    process.exit(ENV_ERROR_EXIT);
  }
  if (!args.stdout && res.stdout) process.stderr.write(res.stdout); // keep our stdout clean-ish
  // The harness exits 0 (all pass) or 1 (a judged metric fails) and always writes the report. Any
  // other outcome — a crash, a signal, no fresh report — is a tooling failure, not a verdict.
  const wroteReport = existsSync(reportJson) && statSync(reportJson).mtimeMs >= startedAt - 1000;
  if ((res.status !== 0 && res.status !== 1) || !wroteReport) {
    console.error(`sim:validate: the Python harness did not produce a report (exit ${res.status ?? `signal ${res.signal}`}). ` +
      `This is a tooling failure, not a failed metric — see the Python error above. Nothing was judged (exit ${ENV_ERROR_EXIT}).`);
    process.exit(ENV_ERROR_EXIT);
  }
  // Print the one-line verdict path for humans/CI.
  console.error(`sim:validate: report written to ${rel(outPrefix)}.md and ${rel(outPrefix)}.json (exit ${res.status})`);
  process.exit(res.status ?? 1);
}

function rel(p) { return p.startsWith(REPO_ROOT) ? p.slice(REPO_ROOT.length + 1) : p; }

main();
