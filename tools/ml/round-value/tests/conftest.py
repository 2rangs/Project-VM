import pathlib
import sys

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]


def make_db(tmp_path, rounds, *, name="fx.duckdb"):
    """Build a tiny VCT-Reference-shaped DuckDB. `rounds` = list of dicts."""
    import duckdb
    p = tmp_path / name
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE matches(match_id VARCHAR, is_international BOOLEAN, utc_timestamp TIMESTAMP, season INTEGER, patch VARCHAR)")
    con.execute("CREATE TABLE maps(game_id VARCHAR, map_name VARCHAR)")
    con.execute("""CREATE TABLE rounds(match_id VARCHAR, game_id VARCHAR, round_num TINYINT,
                   winner_team TINYINT, side VARCHAR, loadout_t0 INTEGER, loadout_t1 INTEGER,
                   bank_t0 INTEGER, bank_t1 INTEGER)""")
    matches = {(r["match_id"]) for r in rounds}
    games = {(r["game_id"], r.get("map_name", "Ascent")) for r in rounds}
    con.executemany("INSERT INTO matches VALUES (?,?,?,?,?)",
                    [(m, True, "2026-01-01 00:00:00", 2026, "P1") for m in matches])
    con.executemany("INSERT INTO maps VALUES (?,?)", list(games))
    con.executemany("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?,?)",
                    [(r["match_id"], r["game_id"], r["round_num"], r["winner_team"], r["side"],
                      r.get("l0", 20000), r.get("l1", 20000), r.get("b0", 1000), r.get("b1", 1000))
                     for r in rounds])
    con.close()
    return str(p)
