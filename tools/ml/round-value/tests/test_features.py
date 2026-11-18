from conftest import make_db
from pv_round_value import features as F


def _game(match, game, specs):
    """specs: list of (round_num, winner_team, side)."""
    return [{"match_id": match, "game_id": game, "round_num": rn, "winner_team": w, "side": s}
            for (rn, w, s) in specs]


def test_no_forbidden_feature_names():
    F.assert_no_forbidden_features()
    assert len(F.FEATURE_NAMES) == 17
    assert F.TARGET not in F.FEATURE_NAMES


def test_columns_split_features_meta_target(tmp_path):
    db = make_db(tmp_path, _game("M1", "G1", [(1, 0, "attack"), (2, 1, "attack")]))
    df = F.build_dataset(db)
    for f in F.FEATURE_NAMES:
        assert f in df.columns
    assert F.TARGET in df.columns
    # metadata present and NOT in the feature matrix
    for m in ("match_id", "utc_timestamp", "season", "patch"):
        assert m in df.columns and m not in F.FEATURE_NAMES


def test_scores_and_streaks_accumulate_from_past_only(tmp_path):
    # team0 attacks all rounds; winners: r1 t0, r2 t1, r3 t1
    db = make_db(tmp_path, _game("M1", "G1",
                                 [(1, 0, "attack"), (2, 1, "attack"), (3, 1, "attack")]))
    df = F.build_dataset(db).sort_values("round_num").reset_index(drop=True)
    r1, r2, r3 = df.iloc[0], df.iloc[1], df.iloc[2]
    # round 1: nothing before
    assert r1["atk_score"] == 0 and r1["def_score"] == 0 and r1["prev_atk_won"] == -1
    # round 2: attacker(t0) won r1 -> atk_score 1, prev_atk_won 1
    assert r2["atk_score"] == 1 and r2["def_score"] == 0 and r2["prev_atk_won"] == 1
    # round 3: t0 lost r2 -> atk_score still 1, def_score 1, atk streak 1 loss, prev_atk_won 0
    assert r3["atk_score"] == 1 and r3["def_score"] == 1
    assert r3["atk_streak_losses"] == 1 and r3["prev_atk_won"] == 0


def test_no_future_leakage(tmp_path):
    """Changing a LATER round's result must not change earlier rounds' features."""
    base = _game("M1", "G1", [(1, 0, "attack"), (2, 0, "attack"), (3, 0, "attack")])
    alt = _game("M1", "G1", [(1, 0, "attack"), (2, 0, "attack"), (3, 1, "attack")])  # r3 flipped
    db_a = make_db(tmp_path, base, name="a.duckdb")
    db_b = make_db(tmp_path, alt, name="b.duckdb")
    da = F.build_dataset(db_a).sort_values("round_num").reset_index(drop=True)
    dbb = F.build_dataset(db_b).sort_values("round_num").reset_index(drop=True)
    # rounds 1 and 2 feature rows must be identical regardless of round 3's outcome
    for i in (0, 1):
        assert list(da.loc[i, F.FEATURE_NAMES]) == list(dbb.loc[i, F.FEATURE_NAMES])


def test_feature_matrix_is_numeric(tmp_path):
    db = make_db(tmp_path, _game("M1", "G1", [(1, 0, "attack"), (2, 1, "defense")]))
    X, y = F.feature_matrix(F.build_dataset(db))
    assert X.dtype.name == "float32" and X.shape[1] == 17
    assert set(y.tolist()) <= {0, 1}
