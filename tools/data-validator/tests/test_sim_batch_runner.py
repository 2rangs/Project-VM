"""Smoke test for the `sim:batch` runner (scripts/sim-batch.mts).

sim:batch drives @pv/match-runner (TypeScript workspace packages) via tsx, so it can only run when
the pnpm workspace is installed. The test skips cleanly otherwise (bare Python CI, no node_modules),
rather than failing — it must not hide a real regression, only sit out when the TS toolchain is absent.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

TOOL_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = TOOL_DIR.parents[1]
BATCH = TOOL_DIR / "scripts" / "sim-batch.mts"
# tsx + the workspace packages are only present after `pnpm install` at the repo root.
_WORKSPACE_READY = (REPO_ROOT / "node_modules" / ".pnpm").exists() and (
    REPO_ROOT / "packages" / "match-runner" / "src" / "index.ts").exists()

pytestmark = pytest.mark.skipif(
    shutil.which("npx") is None or not _WORKSPACE_READY,
    reason="pnpm workspace not installed (needs `pnpm install` + node/npx); sim:batch is a TS runner",
)


def test_batch_runner_exists():
    assert BATCH.exists(), f"missing runner at {BATCH}"


def test_one_match_bundle_shape(tmp_path):
    out = tmp_path / "run.json"
    r = subprocess.run(
        ["npx", "tsx", str(BATCH), "--matches", "1", "--no-validate", "--out", str(out)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=240,
    )
    assert r.returncode == 0, f"stdout={r.stdout}\nstderr={r.stderr}"
    bundle = json.loads(out.read_text())
    assert bundle["meta"]["synthetic"] is True
    assert bundle["meta"]["matches"] == 1
    assert isinstance(bundle["rounds"], list) and len(bundle["rounds"]) >= 12  # at least a half
    rd = bundle["rounds"][0]
    # SimRun contract: each round carries a roster, buyTiers and an events array.
    assert set(rd["roster"].values()) <= {"attack", "defense"}
    assert sum(1 for s in rd["roster"].values() if s == "attack") == 5
    assert set(rd["buyTiers"]) == {"attack", "defense"}
    assert any(e.get("kind") == "roundEnd" for e in rd["events"])
