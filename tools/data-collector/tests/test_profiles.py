import duckdb
import pytest

from pv_data_collector import profiles as P


def test_classify_buy_and_beta_mom():
    assert P.classify_buy(None, True) == "pistol"
    assert P.classify_buy(4000, False) == "eco"
    assert P.classify_buy(12000, False) == "semi"
    assert P.classify_buy(22000, False) == "full"
    assert 1.0 <= P._beta_mom([0.4, 0.5, 0.6, 0.55, 0.45]) <= 500.0


def test_shrunk_rate_pulls_small_n_to_mean():
    hi = P._shrunk_rate(_counter(90, 100), 0.5, 20.0)  # many obs -> near raw 0.9
    lo = P._shrunk_rate(_counter(9, 10), 0.5, 20.0)    # few obs -> near mean 0.5
    assert hi["value"] > lo["value"]
    assert abs(lo["value"] - 0.5) < abs(hi["value"] - 0.5)
    assert P._shrunk_rate(_counter(0, 0), 0.5, 20.0) is None


def _counter(s, n):
    c = P.Counter()
    c.s, c.n = s, n
    return c


def _fixture_db(tmp_path, *, utc="2025-01-01 00:00:00", season=2025, name="tp.duckdb"):
    p = tmp_path / name
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE matches(match_id VARCHAR, is_international BOOLEAN, utc_timestamp TIMESTAMP, season INTEGER, team0_id INTEGER, team1_id INTEGER)")
    con.execute("CREATE TABLE maps(game_id VARCHAR, map_name VARCHAR)")
    con.execute("""CREATE TABLE rounds(match_id VARCHAR, game_id VARCHAR, round_num TINYINT,
                   winner_team TINYINT, side VARCHAR, loadout_t0 INTEGER, loadout_t1 INTEGER,
                   bank_t0 INTEGER, bank_t1 INTEGER)""")
    con.execute("INSERT INTO matches VALUES ('M1', TRUE, ?, ?, 10, 20)", [utc, season])
    con.execute("INSERT INTO maps VALUES ('G1','Ascent')")
    rows = []
    # team0 (id 10) attacks every round and WINS every round; full buys vs eco opponent
    for rn in range(1, 13):
        rows.append(("M1", "G1", rn, 0, "attack", 22000, 3000, 1000, 500))
    con.executemany("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?,?)", rows)
    con.close()
    return str(p)


def test_build_shapes_and_tactical_nulls(tmp_path):
    out = P.build_team_profiles(_fixture_db(tmp_path))
    recs = {r["teamId"]: r for r in out["profiles"]}
    assert set(recs) == {"10", "20"}
    t10 = recs["10"]
    assert "team_name" not in t10 and "name" not in t10  # no names stored
    assert t10["mapPool"] == {"Ascent": 1}
    # every tactical tendency is null with a reason
    for name, reason in P.UNESTIMABLE.items():
        a = t10["tacticalNull"][name]
        assert a["value"] is None and a["reason"]
    assert t10["provenance"]["synthetic"] is False


def test_attack_win_rate_is_correct(tmp_path):
    out = P.build_team_profiles(_fixture_db(tmp_path))
    t10 = next(r for r in out["profiles"] if r["teamId"] == "10")
    t20 = next(r for r in out["profiles"] if r["teamId"] == "20")
    # team 10 attacked and won all rounds -> high attack win; team 20 defended and lost all
    assert t10["side"]["attackWinRate"]["raw"] == 1.0
    assert t20["side"]["defenseWinRate"]["raw"] == 0.0


def test_anti_eco_full_buy_detected(tmp_path):
    out = P.build_team_profiles(_fixture_db(tmp_path))
    t10 = next(r for r in out["profiles"] if r["teamId"] == "10")
    # team 10 full-bought every non-pistol round while opponent was on eco
    assert t10["economy"]["antiEcoFullBuy"]["raw"] == 1.0


def test_as_of_excludes_later_matches(tmp_path):
    db = _fixture_db(tmp_path, utc="2025-06-01 00:00:00")
    assert P.build_team_profiles(db, as_of="2025-01-01")["profiles"] == []  # match is after as_of
    assert len(P.build_team_profiles(db, as_of="2026-01-01")["profiles"]) == 2


def test_determinism(tmp_path):
    db = _fixture_db(tmp_path)
    a = [(r["teamId"], r["economy"], r["side"]) for r in P.build_team_profiles(db)["profiles"]]
    b = [(r["teamId"], r["economy"], r["side"]) for r in P.build_team_profiles(db)["profiles"]]
    assert a == b


def test_missing_db_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        P.build_team_profiles(str(tmp_path / "no.duckdb"))
