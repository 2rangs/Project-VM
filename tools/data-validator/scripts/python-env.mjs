// PROJECT V — Python environment preflight for the sim validation tooling.
//
// sim:validate hands the SimRun bundle to a Python harness. When the interpreter is missing, is a
// venv whose base Python has gone, is too old, or cannot import the harness, the old behaviour was
// a Python traceback AFTER the whole batch had been simulated — and an exit code of 1, the same
// code as "a judged metric failed". This module checks the environment up front, in well under a
// second, and explains what is wrong and how to fix it.
//
//   import { resolvePython, checkPythonEnv, ENV_ERROR_EXIT } from "./python-env.mjs";
//   const env = checkPythonEnv(resolvePython(cliValue), TOOL_DIR);
//   if (!env.ok) { console.error(formatEnvError(env)); process.exit(ENV_ERROR_EXIT); }
//
// Exit codes used by the runners: 0 all judged metrics pass · 1 a judged metric fails ·
// 2 usage error · 3 the Python environment (or the harness itself) is broken — nothing was judged.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { join } from "node:path";

export const ENV_ERROR_EXIT = 3;
/** Oldest Python the harness supports (pyproject.toml requires-python). */
export const MIN_PYTHON = [3, 11];

/** The interpreter to use: an explicit value, else $PYTHON, else `python3` on PATH. */
export function resolvePython(explicit) {
  return explicit ?? process.env.PYTHON ?? "python3";
}

function pathSep() { return process.platform === "win32" ? ";" : ":"; }

/** PYTHONPATH that lets `python -m pv_data_validator.sim_cli` run from the repo checkout. */
export function harnessPythonPath(toolDir) {
  return join(toolDir, "src") + pathSep() + (process.env.PYTHONPATH ?? "");
}

const PROBE = [
  "import json, sys",
  "out = {'version': list(sys.version_info[:3]), 'executable': sys.executable}",
  "try:",
  "    import pv_data_validator.sim_cli  # noqa: F401",
  "    out['harness'] = True",
  "except Exception as e:",
  "    out['harness'] = False",
  "    out['error'] = type(e).__name__ + ': ' + str(e)",
  "print('PVENV ' + json.dumps(out))",
].join("\n");

/**
 * Check that `python` can run the sim harness. Never throws.
 * @returns {{ok: true, python: string, version: string} | {ok: false, python: string, problem: string, detail: string, hint: string}}
 */
export function checkPythonEnv(python, toolDir) {
  const hintAny = `Any Python >= ${MIN_PYTHON.join(".")} works (the sim harness is standard-library only). ` +
    `Point at one with --python <path> or PYTHON=<path>, e.g. PYTHON=$(command -v python3).`;
  const hintVenv = `Recreate it:  python3 -m venv <dir> && PYTHON=<dir>/bin/python …  (no packages need installing for sim:validate).`;
  const fail = (problem, detail, hint) => ({ ok: false, python, problem, detail, hint });

  // A path (not a bare command name) that does not resolve: say whether it is a broken venv link.
  const looksLikePath = python.includes("/") || python.includes("\\");
  if (looksLikePath && !existsSync(python)) {
    let dangling = false;
    try { dangling = lstatSync(python).isSymbolicLink(); } catch { /* not there at all */ }
    return dangling
      ? fail("the virtualenv is broken", `${python} is a symlink to an interpreter that no longer exists (the base Python was removed or upgraded).`, hintVenv)
      : fail("Python interpreter not found", `${python} does not exist.`, hintAny);
  }

  const res = spawnSync(python, ["-c", PROBE], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: harnessPythonPath(toolDir) },
    timeout: 30_000,
  });
  if (res.error) {
    if (res.error.code === "ENOENT") return fail("Python interpreter not found", `"${python}" is not on PATH.`, hintAny);
    if (res.error.code === "EACCES") return fail("Python interpreter is not executable", `${python}: permission denied.`, hintAny);
    if (res.error.code === "ETIMEDOUT") return fail("Python interpreter did not answer", `${python} did not finish a one-line check within 30 s.`, hintAny);
    return fail("Python interpreter could not be started", `${python}: ${res.error.message}`, hintAny);
  }
  const line = (res.stdout ?? "").split("\n").find((l) => l.startsWith("PVENV "));
  if (!line) {
    const last = ((res.stderr ?? "").trim().split("\n").pop() ?? "").trim();
    return fail("Python interpreter failed to run", `${python} exited ${res.status ?? `on signal ${res.signal}`}${last ? `: ${last}` : ""}`, looksLikePath ? hintVenv : hintAny);
  }
  const info = JSON.parse(line.slice("PVENV ".length));
  const version = info.version.join(".");
  const [maj, min] = info.version;
  if (maj < MIN_PYTHON[0] || (maj === MIN_PYTHON[0] && min < MIN_PYTHON[1])) {
    return fail("Python is too old", `${python} is Python ${version}; the harness needs >= ${MIN_PYTHON.join(".")}.`, hintAny);
  }
  if (!info.harness) {
    return fail("Python cannot import the sim harness", `${python} (Python ${version}): ${info.error}`,
      `The harness lives in ${join(toolDir, "src")} and needs no third-party packages; this usually means a damaged checkout or environment.`);
  }
  return { ok: true, python, version };
}

/** Human-readable, multi-line description of a failed check. */
export function formatEnvError(env, prefix = "sim:validate") {
  return [
    `${prefix}: cannot run the Python validation harness — ${env.problem}.`,
    `  ${env.detail}`,
    `  ${env.hint}`,
    `  Nothing was simulated or judged (exit ${ENV_ERROR_EXIT}).`,
  ].join("\n");
}
