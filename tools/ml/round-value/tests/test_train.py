import numpy as np
from conftest import make_db
from pv_round_value import features as F
from pv_round_value import train as T


def test_ece_perfect_and_bad():
    y = np.array([0, 0, 1, 1])
    assert T.ece(y, np.array([0.0, 0.0, 1.0, 1.0])) == 0.0  # perfectly calibrated
    assert T.ece(y, np.array([1.0, 1.0, 0.0, 0.0])) > 0.9   # perfectly wrong


def test_metrics_keys():
    y = np.array([0, 1, 0, 1])
    m = T.metrics(y, np.array([0.3, 0.7, 0.4, 0.6]))
    assert {"logLoss", "brier", "auc", "accuracy", "ece"} <= set(m)


def test_priors_lookup_predictor_pistol_is_half(tmp_path):
    db = make_db(tmp_path, [{"match_id": "M1", "game_id": "G1", "round_num": 1,
                             "winner_team": 0, "side": "attack", "l0": 4000, "l1": 4000}])
    df = F.build_dataset(db)
    pred = T.priors_lookup_predictor("datasets/derived/priors")  # real priors dir
    p = pred(df)
    assert abs(p[0] - 0.5) < 1e-9  # pistol vs pistol -> 0.5


def test_time_holdout_splits_by_match(tmp_path):
    rounds = []
    for mi in range(5):
        for rn in range(1, 5):
            rounds.append({"match_id": f"M{mi}", "game_id": f"G{mi}", "round_num": rn,
                           "winner_team": rn % 2, "side": "attack"})
    db = make_db(tmp_path, rounds)
    df = F.build_dataset(db)
    tr, te = T.time_holdout(df, frac=0.2)
    assert set(tr["match_id"]).isdisjoint(set(te["match_id"]))  # no match in both
    assert len(te) > 0 and len(tr) > 0
