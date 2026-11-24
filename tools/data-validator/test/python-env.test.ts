import { describe, it, expect } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs helper (no type declarations)
import { ENV_ERROR_EXIT, checkPythonEnv, formatEnvError, harnessPythonPath, resolvePython } from "../scripts/python-env.mjs";

const TOOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmp = () => mkdtempSync(join(tmpdir(), "pv-pyenv-"));
/** A stand-in "interpreter": a shell script with the given body. */
function fakePython(body: string): string {
  const p = join(tmp(), "python");
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
  return p;
}

describe("Python environment preflight", () => {
  it("resolves the interpreter: explicit, then $PYTHON, then python3", () => {
    const saved = process.env.PYTHON;
    try {
      process.env.PYTHON = "/env/python";
      expect(resolvePython("/cli/python")).toBe("/cli/python");
      expect(resolvePython(undefined)).toBe("/env/python");
      delete process.env.PYTHON;
      expect(resolvePython(undefined)).toBe("python3");
    } finally { if (saved === undefined) delete process.env.PYTHON; else process.env.PYTHON = saved; }
  });

  it("puts the harness sources on PYTHONPATH", () => {
    expect(harnessPythonPath("/repo/tools/data-validator").startsWith("/repo/tools/data-validator/src")).toBe(true);
  });

  it("a path that does not exist: 'not found', with how to point at a working Python", () => {
    const r = checkPythonEnv("/nonexistent/venv/bin/python", TOOL_DIR);
    expect(r.ok).toBe(false);
    expect(r.problem).toBe("Python interpreter not found");
    expect(r.hint).toMatch(/PYTHON=/);
  });

  it("a dangling symlink (a venv whose base Python is gone) is called a broken virtualenv", () => {
    const dir = join(tmp(), "venv", "bin");
    mkdirSync(dir, { recursive: true });
    symlinkSync("/nonexistent/base/python3.9", join(dir, "python"));
    const r = checkPythonEnv(join(dir, "python"), TOOL_DIR);
    expect(r).toMatchObject({ ok: false, problem: "the virtualenv is broken" });
    expect(r.hint).toMatch(/Recreate it/);
  });

  it("a command that is not on PATH", () => {
    expect(checkPythonEnv("pv-no-such-python-command", TOOL_DIR)).toMatchObject({ ok: false, problem: "Python interpreter not found" });
  });

  it("an interpreter that dies on start reports its last line, not a stack", () => {
    const r = checkPythonEnv(fakePython("echo 'dyld: Library not loaded: libpython3.9.dylib' >&2; exit 134"), TOOL_DIR);
    expect(r).toMatchObject({ ok: false, problem: "Python interpreter failed to run" });
    expect(r.detail).toContain("Library not loaded");
  });

  it("a Python older than the harness supports is named with its version", () => {
    const r = checkPythonEnv(fakePython(`echo 'PVENV {"version": [3, 9, 6], "executable": "x", "harness": true}'`), TOOL_DIR);
    expect(r).toMatchObject({ ok: false, problem: "Python is too old" });
    expect(r.detail).toContain("3.9.6");
  });

  it("a Python that cannot import the harness says which import failed", () => {
    const r = checkPythonEnv(fakePython(`echo 'PVENV {"version": [3, 12, 1], "executable": "x", "harness": false, "error": "ModuleNotFoundError: No module named pv_data_validator"}'`), TOOL_DIR);
    expect(r).toMatchObject({ ok: false, problem: "Python cannot import the sim harness" });
    expect(r.detail).toContain("ModuleNotFoundError");
  });

  it("a working environment passes and reports its version", () => {
    const r = checkPythonEnv(fakePython(`echo 'PVENV {"version": [3, 12, 1], "executable": "x", "harness": true}'`), TOOL_DIR);
    expect(r).toEqual({ ok: true, python: expect.any(String), version: "3.12.1" });
  });

  it("the message is three plain lines plus the exit code — no traceback", () => {
    const msg = formatEnvError(checkPythonEnv("/nonexistent/python", TOOL_DIR), "sim:batch");
    expect(msg.split("\n")).toHaveLength(4);
    expect(msg).toMatch(/^sim:batch: cannot run the Python validation harness — Python interpreter not found\./);
    expect(msg).toContain(`exit ${ENV_ERROR_EXIT}`);
    expect(ENV_ERROR_EXIT).toBe(3);
  });
});
