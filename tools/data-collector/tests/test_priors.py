"""Priors ETL tests. Buy classification is pure; the aggregation is checked against a tiny
hand-built DuckDB fixture so the win-rate math is verified against hand counts."""

import duckdb
import pytest

from pv_data_collector import priors


def test_classify_buy():
    assert priors.classify_buy(None, True) == "pistol"
    assert priors.classify_buy(4999, False) == "eco"
    assert priors.classify_buy(5000, False) == "semi"
    assert priors.classify_buy(19999, False) == "semi"
    assert priors.classify_buy(20000, False) == "full"
    assert priors.classify_buy(None, False) is None


def _fixture_db(tmp_path):
    """Two matches on Ascent, economy present. Hand-countable matchup cells."""
    p = tmp_path / "fx.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE matches(match_id VARCHAR, is_international BOOLEAN, patch VARCHAR, season INTEGER)")
    con.execute("CREATE TABLE maps(game_id VARCHAR, map_name VARCHAR, performance_available BOOLEAN)")
    con.execute("""CREATE TABLE rounds(match_id VARCHAR, game_id VARCHAR, round_num TINYINT,
                   winner_team TINYINT, side VARCHAR, outcome VARCHAR,
                   loadout_t0 INTEGER, loadout_t1 INTEGER)""")
    con.execute("""CREATE TABLE player_map(match_id VARCHAR, game_id VARCHAR,
                   fk_atk TINYINT, fd_atk TINYINT, fk_def TINYINT, fd_def TINYINT)""")
    con.executemany("INSERT INTO matches VALUES (?,?,?,?)",
                    [("M1", True, "P1", 2026), ("M2", True, "P1", 2026)])
    con.executemany("INSERT INTO maps VALUES (?,?,?)", [("G1", "Ascent", True), ("G2", "Ascent", True)])
    # One player's aggregate per map is enough for the opening-duel sums.
    # G1: attackers won first blood 1 round, defenders 1 round. G2: same.
    con.executemany("INSERT INTO player_map VALUES (?,?,?,?,?,?)",
                    [("M1", "G1", 1, 1, 1, 1), ("M2", "G2", 1, 1, 1, 1)])
    rows = [
        # M1/G1: r1 pistol (team0 wins), r2 full(t0) vs eco(t1) team0 wins
        ("M1", "G1", 1, 0, "attack", "elimination", 4000, 4000),
        ("M1", "G1", 2, 0, "attack", "defuse", 22000, 3000),
        # M2/G2: r1 pistol (team1 wins), r2 full(t0) vs eco(t1) team1 wins (an eco upset)
        ("M2", "G2", 1, 1, "attack", "elimination", 4000, 4000),
        ("M2", "G2", 2, 1, "attack", "bomb_detonated", 21000, 2500),
    ]
    con.executemany("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?)", rows)
    con.close()
    return str(p)


def _cell(prior, **dims):
    for e in prior["estimates"]:
        if all(e["dims"].get(k) == v for k, v in dims.items()):
            return e
    return None


def test_matchup_cells_match_hand_counts(tmp_path):
    out = priors.build_all(_fixture_db(tmp_path), iters=50)
    mu = out["economy_matchup.ascent"]

    full_eco = _cell(mu, ownBuy="full", oppBuy="eco")
    assert full_eco["n"] == 2 and full_eco["successes"] == 1 and full_eco["rate"] == 0.5  # 1 win, 1 upset
    eco_full = _cell(mu, ownBuy="eco", oppBuy="full")
    assert eco_full["n"] == 2 and eco_full["successes"] == 1  # mirror perspective
    pistol = _cell(mu, ownBuy="pistol", oppBuy="pistol")
    assert pistol["n"] == 4 and pistol["successes"] == 2 and pistol["rate"] == 0.5  # symmetric diagonal
    # Wilson bounds are ordered and bracket the point.
    assert full_eco["wilsonLow"] <= full_eco["rate"] <= full_eco["wilsonHigh"]


def test_outcome_distribution_sums_to_one(tmp_path):
    out = priors.build_all(_fixture_db(tmp_path), iters=50)
    dist = out["round_outcome_distribution"]
    total = sum(e["rate"] for e in dist["estimates"] if e["dims"]["scope"] == "ascent")
    assert abs(total - 1.0) < 1e-9


def test_pistol_conversion_hand_count(tmp_path):
    out = priors.build_all(_fixture_db(tmp_path), iters=50)
    pc = out["pistol_conversion"]
    combined = _cell(pc, half="combined", step="win_next_round")
    # Both games: pistol winner also won round 2 -> 2/2.
    assert combined["n"] == 2 and combined["successes"] == 2 and combined["rate"] == 1.0


def test_every_prior_has_real_provenance_and_sha(tmp_path):
    out = priors.build_all(_fixture_db(tmp_path), iters=50)
    for name, prior in out.items():
        assert prior["provenance"]["synthetic"] is False, name
        assert prior["source"]["sha256"] and len(prior["source"]["sha256"]) == 64
        assert prior["groupingUnit"] == "match_id"
        for e in prior["estimates"]:
            assert e["wilsonLow"] <= e["wilsonHigh"]


def test_opening_duel_sides_sum_to_one(tmp_path):
    out = priors.build_all(_fixture_db(tmp_path), iters=50)
    od = out["combat_opening_duel"]
    atk = _cell(od, scope="ascent", side="attack")
    dfn = _cell(od, scope="ascent", side="defense")
    assert atk["n"] == dfn["n"]
    assert abs(atk["rate"] + dfn["rate"] - 1.0) < 1e-9  # sides partition the rounds
    assert atk["rate"] == 0.5  # fixture: 2 attacker fk out of 4 opening duels


def test_patch_major():
    assert priors.patch_major("Patch 13.05") == 13
    assert priors.patch_major("Patch 9.02") == 9
    assert priors.patch_major("weird") is None
    assert priors.patch_major(None) is None


def test_era_filter_keeps_recent_patches():
    rows = [{"patch": "Patch 13.05"}, {"patch": "Patch 9.00"}, {"patch": "Patch 5.04"}, {"patch": None}]
    assert len(priors.era_filter(rows, "all")) == 4
    assert [r["patch"] for r in priors.era_filter(rows, "patch>=9")] == ["Patch 13.05", "Patch 9.00"]


def test_build_all_unknown_era_raises(tmp_path):
    with pytest.raises(ValueError):
        priors.build_all(_fixture_db(tmp_path), era="patch>=99x")


def test_missing_db_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        priors.build_all(str(tmp_path / "nope.duckdb"))
