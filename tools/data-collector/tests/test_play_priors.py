"""Play-pattern baselines (KAST, clutch wins per round, plants / post-plant, kill share by role),
checked against a tiny hand-built DuckDB so every number is countable by eye."""

import json

import pytest

from pv_data_collector import priors


def _db(tmp_path):
    """One international match, two Ascent maps.

    G1: 4 rounds — team 0 attacks 3 (rounds 1-3) and defends 1 (round 4). Outcomes: elimination,
        defuse, bomb_detonated, elimination. Plants recorded: 1 + 1 = 2. Detail block present.
    G2: 2 rounds — elimination, defuse. Plants recorded as 0 (a hole in the source); the defuse
        proves at least one plant, so the prior must not report fewer plants than defuses.
        No detail block (no notables): G2 must be left out of the clutch denominator.
    """
    duckdb = pytest.importorskip("duckdb", reason="duckdb not installed; DuckDB-backed ETL test")
    p = tmp_path / "play.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE matches(match_id VARCHAR, is_international BOOLEAN, patch VARCHAR, season INTEGER)")
    con.execute("CREATE TABLE maps(match_id VARCHAR, game_id VARCHAR, map_name VARCHAR, performance_available BOOLEAN)")
    con.execute("""CREATE TABLE rounds(match_id VARCHAR, game_id VARCHAR, round_num TINYINT, winner_team TINYINT,
                   side VARCHAR, outcome VARCHAR, loadout_t0 INTEGER, loadout_t1 INTEGER)""")
    con.execute("""CREATE TABLE player_map(player_id INTEGER, match_id VARCHAR, game_id VARCHAR, team_idx TINYINT,
                   agents VARCHAR[], kills_all TINYINT, deaths_all TINYINT, kast_all TINYINT, kast_atk TINYINT,
                   kast_def TINYINT, fk_atk TINYINT, fd_atk TINYINT, fk_def TINYINT, fd_def TINYINT, plants TINYINT)""")
    con.execute("CREATE TABLE notables(player_id INTEGER, match_id VARCHAR, game_id VARCHAR, stat_type VARCHAR, round_num TINYINT)")
    con.execute("INSERT INTO matches VALUES ('M1', TRUE, 'Patch 9.01', 2026)")
    con.executemany("INSERT INTO maps VALUES (?,?,?,?)", [("M1", "G1", "Ascent", True), ("M1", "G2", "Ascent", True)])
    con.executemany("INSERT INTO rounds VALUES (?,?,?,?,?,?,?,?)", [
        ("M1", "G1", 1, 0, "attack", "elimination", 4000, 4000),
        ("M1", "G1", 2, 1, "attack", "defuse", 22000, 22000),
        ("M1", "G1", 3, 0, "attack", "bomb_detonated", 22000, 22000),
        ("M1", "G1", 4, 0, "defense", "elimination", 22000, 22000),
        ("M1", "G2", 1, 0, "attack", "elimination", 4000, 4000),
        ("M1", "G2", 2, 1, "attack", "defuse", 22000, 22000),
    ])
    # (player, match, game, team, agents, kills, deaths, kast_all, kast_atk, kast_def, fk/fd x4, plants)
    con.executemany("INSERT INTO player_map VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        (1, "M1", "G1", 0, ["jett"], 6, 2, 75, 67, 100, 1, 1, 1, 0, 1),     # duelist, team 0: 4 rounds (3 atk, 1 def)
        (2, "M1", "G1", 1, ["omen"], 2, 6, 50, 100, 33, 0, 1, 1, 1, 1),     # controller, team 1: 4 rounds (1 atk, 3 def)
        (3, "M1", "G2", 0, ["KAY/O"], 3, 1, 100, 100, None, 1, 0, 0, 0, 0),  # initiator (slug spelling differs), team 0: 2 atk rounds
        (4, "M1", "G2", 1, ["mystery"], 1, 3, 50, None, 50, 0, 0, 0, 1, 0),  # agent not in the catalog
    ])
    con.executemany("INSERT INTO notables VALUES (?,?,?,?,?)", [
        (1, "M1", "G1", "clutch_1v2", 3), (1, "M1", "G1", "clutch_1v1", 4), (1, "M1", "G1", "two_k", 1),
    ])
    con.close()
    roles = tmp_path / "agents.json"
    roles.write_text(json.dumps([{"slug": "jett", "role": "Duelist"}, {"slug": "omen", "role": "Controller"},
                                 {"slug": "kayo", "role": "Initiator"}, {"slug": "sage", "role": "Sentinel"}]))
    return str(p), str(roles)


def _cell(prior, **dims):
    return next(e for e in prior["estimates"] if all(e["dims"].get(k) == v for k, v in dims.items()))


def test_play_priors_are_built_with_real_provenance(tmp_path):
    db, roles = _db(tmp_path)
    out = priors.build_all(db, iters=20, agent_roles_path=roles)
    for pid in priors.PLAY_PRIOR_IDS:
        assert pid in out, pid
        assert out[pid]["priorId"] == pid and out[pid]["provenance"]["synthetic"] is False
        assert out[pid]["source"]["filters"]["international"] is True


def test_kast_is_weighted_by_rounds_overall_and_per_side(tmp_path):
    db, roles = _db(tmp_path)
    k = priors.build_all(db, iters=20, agent_roles_path=roles)["kast"]
    # all: p1 75% of 4 = 3, p2 50% of 4 = 2, p3 100% of 2 = 2, p4 50% of 2 = 1  -> 8 of 12 player-rounds
    assert (_cell(k, scope="all_maps", side="all")["successes"], _cell(k, scope="all_maps", side="all")["n"]) == (8, 12)
    # attack: p1 67% of 3 = 2, p2 100% of 1 = 1, p3 100% of 2 = 2 (p4 has no attack KAST) -> 5 of 6
    assert (_cell(k, scope="all_maps", side="attack")["successes"], _cell(k, scope="all_maps", side="attack")["n"]) == (5, 6)
    # defense: p1 100% of 1 = 1, p2 33% of 3 = 1, p4 50% of 2 = 1 (p3 has no defense KAST) -> 3 of 6
    assert (_cell(k, scope="all_maps", side="defense")["successes"], _cell(k, scope="all_maps", side="defense")["n"]) == (3, 6)
    assert _cell(k, scope="ascent", side="all")["rate"] == pytest.approx(8 / 12)


def test_clutch_wins_per_round_uses_only_maps_with_the_detail_block(tmp_path):
    db, roles = _db(tmp_path)
    c = priors.build_all(db, iters=20, agent_roles_path=roles)["clutch_wins_per_round"]
    # Only G1 has notables: 4 rounds. One 1v1 and one 1v2 were won.
    assert (_cell(c, scope="all_maps", x="1v1")["successes"], _cell(c, scope="all_maps", x="1v1")["n"]) == (1, 4)
    assert _cell(c, scope="all_maps", x="1v2")["rate"] == pytest.approx(0.25)
    assert _cell(c, scope="all_maps", x="1v3")["successes"] == 0
    assert _cell(c, scope="all_maps", x="any")["rate"] == pytest.approx(0.5)


def test_plant_rate_and_post_plant_results(tmp_path):
    db, roles = _db(tmp_path)
    p = priors.build_all(db, iters=20, agent_roles_path=roles)["plant_post_plant"]
    # G1: 2 plants in 4 rounds (1 defused, 1 detonated). G2: recorded 0 plants but 1 defuse -> counted as 1.
    rate = _cell(p, scope="all_maps", measure="plant_rate")
    assert (rate["successes"], rate["n"]) == (3, 6)
    win = _cell(p, scope="all_maps", measure="post_plant_attack_win")
    assert (win["successes"], win["n"]) == (1, 3)          # 3 plants, 2 defused -> attack won 1
    det = _cell(p, scope="all_maps", measure="post_plant_detonation")
    assert (det["successes"], det["n"]) == (1, 3)


def test_role_kill_share_normalises_slugs_and_leaves_unknown_agents_out(tmp_path):
    db, roles = _db(tmp_path)
    r = priors.build_all(db, iters=20, agent_roles_path=roles)["role_kill_share"]
    assert (_cell(r, scope="all_maps", role="duelist")["successes"], _cell(r, scope="all_maps", role="duelist")["n"]) == (6, 8)
    assert _cell(r, scope="all_maps", role="controller")["rate"] == pytest.approx(2 / 8)
    assert (_cell(r, scope="all_maps", role="initiator")["successes"], _cell(r, scope="all_maps", role="initiator")["n"]) == (3, 4)  # "KAY/O" -> kayo
    assert _cell(r, scope="all_maps", role="sentinel")["n"] == 0
    assert any("1 player-maps had an agent missing" in n for n in r["method"]["notes"])


def test_role_prior_needs_the_agents_catalog_and_missing_columns_omit_not_guess(tmp_path):
    db, _ = _db(tmp_path)
    out = priors.build_all(db, iters=20)                   # no --agent-roles
    assert "role_kill_share" not in out and "kast" in out
    # A trimmed database (the older test fixture shape) has none of the columns: nothing is invented.
    duckdb = pytest.importorskip("duckdb")
    p = tmp_path / "trim.duckdb"
    con = duckdb.connect(str(p))
    con.execute("CREATE TABLE player_map(match_id VARCHAR, game_id VARCHAR, fk_atk TINYINT)")
    assert priors.build_play_priors(con, None, None, iters=5) == {}
    con.close()


def test_write_all_only_writes_the_named_priors(tmp_path):
    db, roles = _db(tmp_path)
    out = tmp_path / "out"
    written = priors.write_all(db, str(out), iters=20, agent_roles_path=roles, only=["kast", "plant_post_plant"])
    assert sorted(written) == ["kast", "plant_post_plant"]
    assert sorted(f.name for f in out.iterdir()) == ["kast.json", "plant_post_plant.json"]


def test_load_agent_roles_reads_the_committed_catalog():
    from conftest import REPO_ROOT
    roles = priors.load_agent_roles(str(REPO_ROOT / "packages" / "game-data" / "data" / "agents.json"))
    assert roles["jett"] == "duelist" and roles["kayo"] == "initiator" and roles["omen"] == "controller"
    assert set(roles.values()) == {"controller", "duelist", "initiator", "sentinel"}
