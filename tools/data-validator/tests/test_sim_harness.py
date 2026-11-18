import sys
from pathlib import Path

from conftest import DATASETS_DIR

sys.path.insert(0, str(Path(__file__).resolve().parent / "fixtures"))
import sim_fixtures  # noqa: E402
from pv_data_validator import sim_harness  # noqa: E402

PRIORS = str(DATASETS_DIR / "derived" / "priors")


def _by(report, metric, **dims):
    for m in report["metrics"]:
        if m["metric"] == metric and all(m["dims"].get(k) == v for k, v in dims.items()):
            return m
    return None


def test_good_run_passes_all_judged_metrics():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent")
    assert rep["summary"]["judged"] > 0
    assert rep["summary"]["allPassed"], [m for m in rep["metrics"] if m["passed"] is False]


def test_bad_run_fails():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.bad_run(), PRIORS, scope="ascent")
    assert not rep["summary"]["allPassed"]
    # attacker win rate 0.90 must fail against ~0.509
    side = _by(rep, "side_winrate", side="attack", phase="all")
    assert side["passed"] is False
    # opening duel 0.90 must fail against ~0.437
    od = _by(rep, "opening_duel", side="attack")
    assert od["passed"] is False


def test_outcome_distribution_matches_baseline_in_good_run():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent")
    elim = _by(rep, "round_outcome_distribution", outcome="elimination")
    assert abs(elim["simValue"] - 0.71) <= 0.02  # remainder rounding puts it at ~0.72
    assert elim["passed"] is True                 # within tolerance of the 0.714 Ascent baseline


def test_report_only_metrics_have_no_passfail():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent")
    trade = _by(rep, "trade_rate")
    assert trade["passed"] is None  # no real baseline
    dur = _by(rep, "round_duration_ms")
    assert dur["passed"] is None and dur["simValue"] == 60_000
    # man-advantage states are reported, never pass/fail
    man = [m for m in rep["metrics"] if m["metric"] == "man_advantage"]
    assert man and all(m["passed"] is None for m in man)


def test_markdown_report_renders():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent")
    md = sim_harness.report_markdown(rep)
    assert "Simulation Validation Report" in md
    assert "PASS" in md


def test_era_selects_patch_ge9_baselines():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent", era="patch>=9")
    assert rep["era"] == "patch>=9"
    # it still produces judged metrics against the patch>=9 baseline set
    assert rep["summary"]["judged"] > 0


def test_economy_matchup_full_vs_full_is_judged():
    rep = sim_harness.evaluate_sim_run(sim_fixtures.good_run(), PRIORS, scope="ascent")
    cell = _by(rep, "economy_matchup", ownBuy="full", oppBuy="full")
    assert cell is not None and cell["passed"] is True  # 0.50 vs 0.50
