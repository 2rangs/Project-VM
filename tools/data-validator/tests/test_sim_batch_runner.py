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


def _teams(*flags):
    r = subprocess.run(
        ["npx", "tsx", str(BATCH), "--teams-only", *flags],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=240,
    )
    assert r.returncode == 0, f"stdout={r.stdout}\nstderr={r.stderr}"
    return json.loads(r.stdout)


def test_default_batch_plays_real_rosters():
    """The default batch must field real game-data players, not the 0.6 league-average fallback.

    Every batch before 2026-11-23 silently played league-average mirrors (team ids read as `t.id`).
    Real rosters show a spread of ratings within and across teams.
    """
    out = _teams()
    assert out["mirror"] is False
    teams = out["teams"]
    assert len(teams) >= 20
    assert len({t["id"] for t in teams}) == len(teams), "team ids must be distinct"
    aims = [p["aim"] for t in teams for p in t["firstFive"]]
    assert len(set(aims)) > 50, "player aim ratings should differ"
    assert max(aims) - min(aims) > 0.2, f"aim spread too small: {min(aims)}..{max(aims)}"
    assert sum(1 for a in aims if a == 0.6) < len(aims) / 4, "most players fell back to 0.6"
    team_means = [sum(p["aim"] for p in t["firstFive"]) / 5 for t in teams]
    assert max(team_means) - min(team_means) > 0.05, "teams should differ in strength"


def test_mirror_flag_plays_league_average():
    out = _teams("--mirror")
    assert out["mirror"] is True
    values = {v for t in out["teams"] for p in t["firstFive"] for v in p.values()}
    assert values == {0.6}
