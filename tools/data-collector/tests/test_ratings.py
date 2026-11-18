import duckdb
import pytest

from pv_data_collector import ratings as R


def test_role_of_picks_dominant_known_role():
    assert R.role_of({"jett": 5, "sova": 1}) == "duelist"
    assert R.role_of({"omen": 3, "astra": 2}) == "controller"
    assert R.role_of({"killjoy": 4}) == "sentinel"
    # unknown is ignored when a known role exists
    assert R.role_of({"miks": 10, "sova": 1}) == "initiator"


def test_shrink_pulls_small_samples_to_mean():
    mu, k = 100.0, 10.0
    hi_n, _ = R.shrink(200.0, 100, mu, k)   # many maps -> close to raw
    lo_n, _ = R.shrink(200.0, 1, mu, k)     # one map -> close to mean
    assert hi_n > lo_n
    assert abs(lo_n - mu) < abs(hi_n - mu)
    assert R.shrink(None, 5, mu, k) is None


def test_to_skill_median_is_0_6():
    assert R._to_skill(0.5) == 0.6
    assert R._to_skill(0.0) == 0.35
    assert R._to_skill(1.0) == 0.85


def _fixture_db(tmp_path):
    p = tmp_path / "r.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE matches(match_id VARCHAR, is_international BOOLEAN, season INTEGER)")
    con.execute("CREATE TABLE player_map(player_id INTEGER, match_id VARCHAR, game_id VARCHAR, agents VARCHAR[], "
                "acs_all SMALLINT, adr_all SMALLINT, kast_all TINYINT, hs_pct_all TINYINT, rating_all DOUBLE, "
                "fk_all TINYINT, fd_all TINYINT, clutch_1v1 TINYINT, clutch_1v2 TINYINT, clutch_1v3 TINYINT, "
                "clutch_1v4 TINYINT, clutch_1v5 TINYINT)")
    matches = [("M1", True, 2025), ("M2", True, 2026)]
    con.executemany("INSERT INTO matches VALUES (?,?,?)", matches)
    rows = []
    # player 1: high stats, duelist, many maps across 2 seasons
    for i in range(20):
        mid = "M1" if i < 10 else "M2"
        rows.append((1, mid, f"G1{i}", ["jett"], 240, 160, 75, 30, 1.2, 3, 2, 1, 0, 0, 0, 0))
    # player 2: low stats, controller, 1 map (low sample)
    rows.append((2, "M1", "G20", ["omen"], 150, 100, 65, 18, 0.8, 1, 2, 0, 0, 0, 0, 0))
    # player 3: average, sentinel, moderate maps
    for i in range(8):
        rows.append((3, "M1" if i < 4 else "M2", f"G3{i}", ["killjoy"], 190, 130, 70, 22, 1.0, 1, 1, 1, 0, 0, 0, 0))
    con.executemany("INSERT INTO player_map VALUES (" + ",".join(["?"] * 16) + ")", rows)
    con.close()
    return str(p)


def test_build_ratings_shapes_and_nulls(tmp_path):
    out = R.build_ratings(_fixture_db(tmp_path))
    recs = {r["playerId"]: r for r in out["ratings"]}
    assert set(recs) == {"1", "2", "3"}
    p1 = recs["1"]
    assert p1["role"] == "duelist" and p1["maps"] == 20
    assert "player_name" not in p1 and "handle" not in p1  # no names stored
    # estimated attributes are on [0,1]
    assert 0 <= p1["attributes"]["aim"]["value"] <= 1
    # every unestimable attribute is null WITH a reason
    for name, reason in R.UNESTIMABLE.items():
        a = p1["attributes"][name]
        assert a["value"] is None and a["reason"]
    # provenance is real (not synthetic) and schema-complete
    assert p1["provenance"]["synthetic"] is False
    assert p1["provenance"]["retrievedAt"] and p1["provenance"]["evidenceType"] == "derived"


def test_low_sample_flagged_and_shrunk(tmp_path):
    out = R.build_ratings(_fixture_db(tmp_path))
    p2 = next(r for r in out["ratings"] if r["playerId"] == "2")
    assert p2["lowSample"] is True
    assert p2["attributes"]["aim"]["uncertainty"] >= 0.1  # low-sample -> wider uncertainty


def test_validation_shrinkage_and_correlations(tmp_path):
    out = R.build_ratings(_fixture_db(tmp_path))
    gain = R.time_split_shrinkage_gain(out["aggregates"], "acs", "acs_all")
    assert gain["players"] >= 1
    corr = R.attribute_correlations(out["ratings"])
    assert "correlations" in corr


def test_determinism_of_attributes(tmp_path):
    db = _fixture_db(tmp_path)
    a = {r["playerId"]: r["attributes"] for r in R.build_ratings(db)["ratings"]}
    b = {r["playerId"]: r["attributes"] for r in R.build_ratings(db)["ratings"]}
    assert a == b  # attributes are deterministic (provenance timestamp excluded)


def test_missing_db_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        R.build_ratings(str(tmp_path / "none.duckdb"))
