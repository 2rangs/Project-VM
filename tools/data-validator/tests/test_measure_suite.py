"""The measurement suite runner (scripts/measure-suite.mts): what it plans to run, that every batch
goes through the heavy-run lock, that no two batches share an output path, and its usage errors.
`--plan` prints the plan and runs nothing, so these tests are fast."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
SUITE = TOOL_DIR / "scripts" / "measure-suite.mts"
_WORKSPACE_READY = (REPO_ROOT / "node_modules" / ".pnpm").exists()

pytestmark = pytest.mark.skipif(shutil.which("npx") is None or not _WORKSPACE_READY,
                                reason="pnpm workspace not installed; measure-suite is a TS runner")


def _suite(*args, env=None):
    return subprocess.run(["npx", "tsx", str(SUITE), *args], cwd=REPO_ROOT, capture_output=True, text=True,
                          env={**os.environ, **(env or {})}, timeout=120)


def _plan(*args, env=None):
    r = _suite("--plan", *args, env=env)
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_default_plan_is_the_regular_suite():
    plan = _plan("--run-id", "t")
    ids = [b["id"] for b in plan["batches"]]
    assert ids[:3] == ["default", "seed161", "abilities"]
    maps = [i for i in ids if i.startswith("map-")]
    assert len(maps) == 11 and "map-ascent" in maps and "map-haven" in maps
    by = {b["id"]: b for b in plan["batches"]}
    assert by["default"]["args"] == ["--matches", "160", "--seed-start", "1"]
    assert by["seed161"]["args"] == ["--matches", "160", "--seed-start", "161"]
    assert by["abilities"]["args"] == ["--matches", "160", "--seed-start", "1", "--abilities"]
    assert by["map-haven"]["args"] == ["--matches", "60", "--seed-start", "1", "--map", "Haven", "--geometry", "own"]


def test_every_batch_goes_through_the_lock_one_command_each():
    plan = _plan("--run-id", "t", "--lock", "/some/heavy-run.sh")
    for b in plan["batches"]:
        cmd = b["command"]
        assert cmd[0] == "/some/heavy-run.sh" and cmd[2] == "--", cmd
        assert b["id"] in cmd[1], "the lock label names the batch"
        assert cmd[3:6] == ["npx", "tsx", "tools/data-validator/scripts/sim-batch.mts"]
        assert cmd.count("--out") == 1 and cmd.count("--report") == 1


def test_lock_comes_from_the_environment_and_can_be_switched_off_explicitly():
    assert _plan("--run-id", "t", env={"PV_HEAVY_RUN": "/env/lock.sh"})["lock"] == "/env/lock.sh"
    off = _plan("--run-id", "t", "--no-lock")
    assert off["lock"] is None and off["batches"][0]["command"][0] == "npx"


def test_output_paths_are_distinct_across_batches_and_kinds():
    plan = _plan("--run-id", "t")
    paths = []
    for b in plan["batches"]:
        assert b["out"] != b["report"] + ".json", "the bundle must not overwrite the report"
        paths += [b["out"], b["report"] + ".json", b["report"] + ".md", b["report"] + ".engine.json", b["log"]]
        assert all(p.startswith("reports/suite/t/") for p in (b["out"], b["report"], b["log"]))
    assert len(paths) == len(set(paths))


def test_small_counts_and_map_selection_for_a_dry_run():
    plan = _plan("--run-id", "t", "--matches", "2", "--map-matches", "1", "--maps", "ascent,haven")
    assert [b["id"] for b in plan["batches"]] == ["default", "seed161", "abilities", "map-ascent", "map-haven"]
    assert plan["batches"][1]["args"] == ["--matches", "2", "--seed-start", "161"]  # always the unseen range
    assert plan["batches"][4]["matches"] == 1
    only = _plan("--run-id", "t", "--only", "abilities,map-split")
    assert [b["id"] for b in only["batches"]] == ["abilities", "map-split"]


@pytest.mark.parametrize("args,needle", [
    (["--bogus"], "unknown option --bogus"),
    (["--matches", "0"], "--matches must be a whole number"),
    (["--maps", "atlantis"], 'unknown map "atlantis"'),
    (["--only", "nope"], "unknown batch id"),
    (["--run-id", "../x"], "--run-id may contain only"),
])
def test_usage_errors_exit_2(args, needle):
    r = _suite("--plan", *args)
    assert r.returncode == 2 and needle in r.stderr, r.stderr


def test_missing_lock_script_stops_before_anything_runs(tmp_path):
    r = _suite("--matches", "1", "--only", "default", "--out-dir", str(tmp_path), "--lock", str(tmp_path / "no-such-lock.sh"))
    assert r.returncode == 2
    assert "heavy-run lock script not found" in r.stderr and "--no-lock" in r.stderr
    assert not any(tmp_path.iterdir()), "nothing may be written or simulated"


def test_broken_python_stops_the_suite_before_the_first_batch(tmp_path):
    lock = tmp_path / "lock.sh"
    lock.write_text("#!/bin/sh\nshift; shift; exec \"$@\"\n")
    lock.chmod(0o755)
    r = _suite("--matches", "1", "--only", "default", "--out-dir", str(tmp_path / "out"), "--lock", str(lock),
               env={"PYTHON": "/nonexistent/python"})
    assert r.returncode == 3
    assert "measure-suite: cannot run the Python validation harness" in r.stderr
    assert not (tmp_path / "out").exists()
