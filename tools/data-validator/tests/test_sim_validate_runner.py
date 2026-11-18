"""Smoke tests for the `sim:validate` Node runner (scripts/sim-validate.mjs).

The runner is the `pnpm sim:validate` entry: it bridges the Match Runner's SimRun export to the
Python `pv-validate-sim` harness. These tests drive it via subprocess and are skipped cleanly if
Node is unavailable (the Python test env does not require it).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]
RUNNER = TOOL_DIR / "scripts" / "sim-validate.mjs"
REPO_ROOT = TOOL_DIR.parents[1]

pytestmark = pytest.mark.skipif(shutil.which("node") is None,
                                reason="node not installed; sim:validate runner is a Node entry")


def _run(args, cwd=REPO_ROOT, input_text=None):
    return subprocess.run(["node", str(RUNNER), *args], cwd=cwd, input=input_text,
                          capture_output=True, text=True)


def test_runner_exists():
    assert RUNNER.exists(), f"missing runner at {RUNNER}"


def test_example_good_run_passes(tmp_path):
    out = tmp_path / "rep"
    r = _run(["--example", "--out", str(out)])
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "rep.json").exists() and (tmp_path / "rep.md").exists()
    rep = json.loads((tmp_path / "rep.json").read_text())
    assert rep["era"] == "all"  # default = PV-2 recommendation
    assert rep["summary"]["allPassed"] is True


def test_bad_run_exits_nonzero(tmp_path):
    bad = TOOL_DIR / "examples" / "sim_run_bad.json"
    r = _run(["--logs", str(bad), "--out", str(tmp_path / "rep")])
    assert r.returncode == 1, f"expected judged-metric failure to exit 1, got {r.returncode}"


def test_era_override_flag(tmp_path):
    r = _run(["--example", "--era", "patch>=9", "--out", str(tmp_path / "rep")])
    assert r.returncode == 0, r.stderr
    rep = json.loads((tmp_path / "rep.json").read_text())
    assert rep["era"] == "patch>=9"


def test_invalid_era_is_usage_error(tmp_path):
    r = _run(["--example", "--era", "nope", "--out", str(tmp_path / "rep")])
    assert r.returncode == 2, "invalid --era should be a usage error (exit 2)"


def test_empty_rounds_rejected_before_python():
    r = _run(["--logs", "-"], input_text=json.dumps({"meta": {}, "rounds": []}))
    assert r.returncode == 2
    assert "not a valid SimRun" in r.stderr


def test_stdin_good_run(tmp_path):
    payload = (TOOL_DIR / "examples" / "sim_run_good.json").read_text()
    r = _run(["--logs", "-", "--out", str(tmp_path / "rep")], input_text=payload)
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "rep.md").exists()
