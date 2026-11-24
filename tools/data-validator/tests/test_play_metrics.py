"""The report-only play metrics, checked against hand-built rounds (every expectation is countable
by eye from the events below)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from pv_data_validator import sim_harness as h

ROSTER = {**{f"a{i}": "attack" for i in range(1, 6)}, **{f"d{i}": "defense" for i in range(1, 6)}}
ROLES = {"a1": "duelist", "a2": "controller", "a3": "initiator", "a4": "sentinel", "a5": "initiator",
         "d1": "duelist", "d2": "controller", "d3": "initiator", "d4": "sentinel", "d5": "initiator"}
PRIORS = Path(__file__).resolve().parents[3] / "datasets" / "derived" / "priors"


def rnd(kills, winner, reason, end_ms, plant_ms=None, start_ms=0):
    """A round from (timeMs, killer, victim) kills, an optional plant time and the round end."""
    ev = [{"kind": "roundStart", "seq": 0, "timeMs": start_ms}]
    stream = [(t, "kill", k, v) for t, k, v in kills]
    if plant_ms is not None:
        stream.append((plant_ms, "spikePlanted", None, None))
    for seq, (t, kind, k, v) in enumerate(sorted(stream, key=lambda x: x[0]), start=1):
        ev.append({"kind": "kill", "seq": seq, "timeMs": t, "killer": k, "victim": v, "assists": []} if kind == "kill"
                  else {"kind": "spikePlanted", "seq": seq, "timeMs": t})
    ev.append({"kind": "roundEnd", "seq": len(ev), "timeMs": end_ms, "winner": winner, "reason": reason})
    return {"roundNumber": 2, "map": "Ascent", "roster": ROSTER, "roles": ROLES, "events": ev}


# R1: attack wipes the defense without a loss (flawless), first kill at 10 s, no plant, 30 s long.
R1 = rnd([(10_000, "a1", "d1"), (11_000, "a1", "d2"), (12_000, "a2", "d3"), (20_000, "a3", "d4"), (29_000, "a1", "d5")],
         "attack", "elimination", 30_000)
# R2: defense wins 5-1; first kill at 20 s by the defense; d1 is traded 2 s after killing a1.
R2 = rnd([(20_000, "d1", "a1"), (22_000, "a2", "d1"), (30_000, "d2", "a2"), (31_000, "d2", "a3"),
          (40_000, "d3", "a4"), (41_000, "d3", "a5")], "defense", "elimination", 41_000)
# R3: plant at 30 s with 3 attackers v 4 defenders alive (advantage -1); the spike detonates at 75 s.
#     a3 becomes the last attacker alive against 3 defenders (1v3), survives, and the attack wins.
R3 = rnd([(8_000, "d1", "a1"), (9_000, "d1", "a2"), (15_000, "a3", "d1"),
          (40_000, "a3", "d2"), (41_000, "d3", "a4"), (42_000, "d3", "a5"), (50_000, "a3", "d3")],
         "attack", "spikeDetonation", 75_000, plant_ms=30_000)
# R4: plant at 20 s at 5v5 (advantage 0); defused at 60 s. The last attacker (a5, 1v3) dies: no clutch.
R4 = rnd([(25_000, "d1", "a1"), (26_000, "a2", "d1"), (27_000, "d2", "a2"), (28_000, "a3", "d2"),
          (35_000, "d3", "a3"), (36_000, "d3", "a4"), (45_000, "d4", "a5")],
         "defense", "spikeDefused", 60_000, plant_ms=20_000)
ROUNDS = [R1, R2, R3, R4]


def test_first_kill_times_and_distribution():
    assert h.first_kill_times_s(ROUNDS) == [10.0, 20.0, 8.0, 25.0]
    d = h.distribution([10.0, 20.0, 8.0, 25.0])
    assert d["mean"] == pytest.approx(15.75)
    assert d["p50"] == pytest.approx(15.0)       # midway between 10 and 20
    assert h.quantile([], 0.5) is None


def test_flawless_rounds():
    assert h.flawless_rounds(ROUNDS) == (1, 4)   # only R1: the winner lost nobody


def test_round_duration_all_and_by_outcome():
    all_, by = h.round_durations_s(ROUNDS)
    assert all_ == [30.0, 41.0, 75.0, 60.0]
    assert by == {"elimination": [30.0, 41.0], "bomb_detonated": [75.0], "defuse": [60.0]}


def test_plant_to_end():
    all_, by = h.plant_to_end_s(ROUNDS)
    assert all_ == [45.0, 40.0]                  # R3: 75-30, R4: 60-20
    assert by == {"bomb_detonated": [45.0], "defuse": [40.0]}


def test_trades_within_three_seconds_vs_five():
    # Deaths: 5 + 6 + 7 + 7 = 25. Traded within 3 s (victim's teammate kills an opponent):
    #   R2: a1 (a2 kills d1 +2 s)                                              -> 1
    #   R3: d2 (d3 kills a4 +1 s), a4 (d3's kill... no: a4's teammate a3 kills d3 at +9 s) -> d2 only -> 1
    #   R4: a1 (a2 kills d1 +1 s), d1 (d2 kills a2 +1 s), a2 (a3 kills d2 +1 s) -> 3
    assert h.trade_rate(ROUNDS, 3_000) == (5, 25)
    wide = h.trade_rate(ROUNDS, 5_000)
    assert wide[1] == 25 and wide[0] >= 5        # a wider window can only add trades


def test_post_plant_rate_and_by_man_advantage():
    pp = h.post_plant(ROUNDS)
    assert pp["plant_rate"] == (2, 4)
    assert pp["post_plant_attack_win"] == (1, 2)
    assert pp["post_plant_detonation"] == (1, 2)
    assert pp["by_advantage"]["-1"] == (1, 1)    # R3: 3 attackers v 4 defenders at the plant, attack won
    assert pp["by_advantage"]["0"] == (0, 1)     # R4: 5v5 at the plant, defused
    assert pp["by_advantage"]["+1"] == (0, 0)


def test_clutches_attempts_wins_and_per_round():
    cl = h.clutches(ROUNDS)
    # R1: d5 is the last defender v 5 attackers -> 1v5 attempt, lost.
    # R2: a5 is the last attacker v 4 defenders (d1 was traded) -> 1v4, lost.
    # R3: a3 is the last attacker v 3 defenders (d3, d4, d5) -> 1v3; survives and the spike detonates: a clutch.
    # R4: a5 is the last attacker v 3 defenders -> 1v3; killed, round lost.
    assert cl["win_rate"]["1v5"] == (0, 1)
    assert cl["win_rate"]["1v4"] == (0, 1)
    assert cl["win_rate"]["1v3"] == (1, 2)
    assert cl["win_rate"]["1v2"] == (0, 0)
    assert cl["wins_per_round"]["1v3"] == (1, 4)
    assert cl["wins_per_round"]["any"] == (1, 4)


def test_dead_last_player_is_not_credited_a_clutch():
    # The last attacker plants (alive v 2), is killed, and the spike still detonates: the team wins,
    # but nobody clutched.
    r = rnd([(5_000, "d1", "a1"), (6_000, "d1", "a2"), (7_000, "d1", "a3"), (8_000, "d1", "a4"),
             (9_000, "a5", "d1"), (10_000, "a5", "d2"), (11_000, "a5", "d3"), (40_000, "d4", "a5")],
            "attack", "spikeDetonation", 70_000, plant_ms=20_000)
    cl = h.clutches([r])
    assert cl["win_rate"]["1v5"] == (0, 1)
    assert cl["wins_per_round"]["any"] == (0, 1)


def test_kast_counts_kill_survive_trade():
    k = h.kast([R2])
    # R2 attackers: a2 has a kill; a1 died but was traded (d1 dies 2 s later); a3, a4, a5 died untraded -> 2/5.
    assert k["attack"] == (2, 5)
    # Defenders: d1 (kill), d2 (kill, alive), d3 (kill, alive), d4 and d5 alive -> 5/5.
    assert k["defense"] == (5, 5)
    assert k["all"] == (7, 10)


def test_kast_counts_assists_when_the_log_has_them():
    r = json.loads(json.dumps(R2))
    next(e for e in r["events"] if e.get("killer") == "a2")["assists"] = ["a3"]
    assert h.kast([r])["attack"] == (3, 5)


def test_role_kill_share():
    share = h.role_kill_share([R1])
    # R1 kills: a1 (duelist) x3, a2 (controller) x1, a3 (initiator) x1. Deaths: d1 duelist, d2 controller,
    # d3 initiator, d4 sentinel, d5 initiator.
    assert share["duelist"] == (3, 4)
    assert share["controller"] == (1, 2)
    assert share["initiator"] == (1, 3)
    assert share["sentinel"] == (0, 1)
    assert h.role_kill_share([{**R1, "roles": None}]) == {}


def _rows(report, metric):
    return [m for m in report["metrics"] if m["metric"] == metric]


def test_report_rows_are_report_only_and_carry_vct_references():
    engine = {"movement": {"rounds": 4,
                           "siteArrival": {"spreadFirstToLastS": {"n": 4, "mean": 3.0, "p50": 2.5, "p90": 6.0},
                                           "consecutiveGapS": {"n": 9, "mean": 1.0, "p50": 0.8, "p90": 2.0}},
                           "pathDiversity": {"leadRouteEntropyBits": 2.2, "distinctLeadRoutes": 7, "routeEntropyBits": 3.1},
                           "bodyOverlap": {"tickShare": 0.02, "roundShare": 0.4}}}
    rep = h.evaluate_sim_run({"meta": {"synthetic": True}, "engine": engine, "rounds": ROUNDS}, str(PRIORS), scope="ascent")
    by = {(m["metric"], json.dumps(m["dims"], sort_keys=True)): m for m in rep["metrics"]}
    new = ["first_kill_time_s", "first_kill_early", "flawless_rounds", "round_duration_s", "plant_to_end_s", "trade_rate_3s",
           "post_plant", "post_plant_by_advantage", "clutch_win_rate", "clutch_wins_per_round", "kast", "role_kill_share",
           "site_arrival_spread_s", "route_diversity", "body_overlap"]
    for name in new:
        rows = _rows(rep, name)
        assert rows, f"missing metric {name}"
        assert all(m["passed"] is None for m in rows), f"{name} must be report-only"
    # units
    assert by[("first_kill_time_s", '{"stat": "p50"}')]["unit"] == "s"
    assert by[("route_diversity", '{"routes": "lead", "stat": "entropy"}')]["unit"] == "bits"
    assert by[("route_diversity", '{"routes": "lead", "stat": "distinct"}')]["simValue"] == 7
    assert by[("site_arrival_spread_s", '{"span": "first_to_last", "stat": "p50"}')]["simValue"] == 2.5
    assert by[("body_overlap", '{"share": "ticks"}')]["simValue"] == 0.02
    # VCT references (Ascent scope where the prior has it)
    kast = by[("kast", '{"side": "all"}')]
    assert kast["realRate"] == pytest.approx(0.711, abs=0.01) and "reference only: kast" in kast["note"]
    plant = by[("post_plant", '{"measure": "plant_rate"}')]
    assert plant["simValue"] == 0.5 and plant["realRate"] == pytest.approx(0.60, abs=0.02) and plant["scope"] == "ascent"
    assert by[("clutch_wins_per_round", '{"x": "1v2"}')]["realRate"] == pytest.approx(0.05, abs=0.01)
    assert by[("role_kill_share", '{"role": "duelist"}')]["realRate"] == pytest.approx(0.514, abs=0.01)
    # no baseline where the source has none
    assert by[("flawless_rounds", "{}")]["realRate"] is None
    assert by[("clutch_win_rate", '{"x": "1v3"}')]["realRate"] is None
    # the new rows never change the verdict
    judged = [m for m in rep["metrics"] if m["passed"] is not None]
    assert {m["metric"] for m in judged} <= {"round_outcome_distribution", "side_winrate", "opening_duel", "economy_matchup"}


def test_markdown_renders_units():
    rep = h.evaluate_sim_run({"meta": {"synthetic": True}, "rounds": ROUNDS}, str(PRIORS), scope="ascent")
    md = h.report_markdown(rep)
    assert "| first_kill_time_s | stat=p50 | 15.0s |" in md
    assert "| flawless_rounds | — | 0.250 |" in md
    assert h.format_value(2.345, "bits") == "2.35 bits"
    assert h.format_value(-1.26, "s", signed=True) == "-1.3s"
    assert h.format_value(None) == "—"


def test_bundles_without_engine_or_roles_still_validate():
    plain = [{k: v for k, v in r.items() if k != "roles"} for r in ROUNDS]
    rep = h.evaluate_sim_run({"meta": {"synthetic": True}, "rounds": plain}, str(PRIORS), scope="ascent")
    assert not _rows(rep, "role_kill_share") and not _rows(rep, "body_overlap")
    assert _rows(rep, "kast")
