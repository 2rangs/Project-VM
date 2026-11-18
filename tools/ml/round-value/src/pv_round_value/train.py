"""Train + evaluate the round-value model and export ONNX.

Baselines (priors lookup, logistic regression) vs LightGBM. Evaluated on a TIME holdout (most recent
matches) and with match-grouped CV, so no round of a match is split across train/test and no future
information reaches a past prediction (README §22.3-22.4). If LightGBM does not beat the baselines we
say so — not adopting the model is a valid outcome (DECISION-005: the engine works without it).

Run:
    PYTHONPATH=src python -m pv_round_value.train --db datasets/raw/vct-reference/vct.duckdb \
        --priors datasets/derived/priors --out models/round-value
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import features as F

SEED = 20260101
CODE_TIER = {v: k for k, v in F.TIER_CODE.items()}
CAT_IDX = [F.FEATURE_NAMES.index(c) for c in ("map_code", "atk_tier_code", "def_tier_code")]


def ece(y, p, bins=10) -> float:
    """Expected calibration error."""
    edges = np.linspace(0, 1, bins + 1)
    idx = np.clip(np.digitize(p, edges) - 1, 0, bins - 1)
    total = 0.0
    for b in range(bins):
        m = idx == b
        if not m.any():
            continue
        total += (m.mean()) * abs(y[m].mean() - p[m].mean())
    return float(total)


def metrics(y, p) -> dict:
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return {
        "logLoss": float(log_loss(y, p)),
        "brier": float(brier_score_loss(y, p)),
        "auc": float(roc_auc_score(y, p)) if len(np.unique(y)) > 1 else float("nan"),
        "accuracy": float(np.mean((p >= 0.5) == y)),
        "ece": ece(y, p),
    }


def priors_lookup_predictor(priors_dir: str):
    path = os.path.join(priors_dir, "economy_matchup.international.json")
    table = {}
    if os.path.exists(path):
        for e in json.load(open(path))["estimates"]:
            table[(e["dims"]["ownBuy"], e["dims"]["oppBuy"])] = e["rate"]

    def predict(df: pd.DataFrame) -> np.ndarray:
        out = np.empty(len(df))
        for i, (a, d) in enumerate(zip(df["atk_tier_code"].to_numpy(), df["def_tier_code"].to_numpy())):
            at, dt_ = CODE_TIER[int(a)], CODE_TIER[int(d)]
            r = table.get((at, dt_))
            if r is None:
                inv = table.get((dt_, at))
                r = (1 - inv) if inv is not None else 0.5
            out[i] = r
        return out

    return predict


def time_holdout(df: pd.DataFrame, frac=0.2):
    """Most-recent `frac` of matches (by first-seen time) -> test; the rest -> train."""
    order = df.groupby("match_id")["utc_timestamp"].min().sort_values()
    n_test = max(1, int(len(order) * frac))
    test_matches = set(order.index[-n_test:])
    te = df["match_id"].isin(test_matches).to_numpy()
    return df[~te].reset_index(drop=True), df[te].reset_index(drop=True)


def train_lightgbm(Xtr, ytr, n_estimators=400):
    import lightgbm as lgb
    model = lgb.LGBMClassifier(
        objective="binary", n_estimators=n_estimators, learning_rate=0.03, num_leaves=31,
        min_child_samples=100, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
        reg_lambda=1.0, random_state=SEED, verbose=-1,
    )
    model.fit(Xtr, ytr, categorical_feature=CAT_IDX)
    return model


def cv_logloss(df: pd.DataFrame, n_estimators: int, folds=5) -> float:
    X, y = F.feature_matrix(df)
    groups = df["match_id"].to_numpy()
    losses = []
    for tr, te in GroupKFold(n_splits=folds).split(X, y, groups):
        m = train_lightgbm(X[tr], y[tr], n_estimators)
        p = m.predict_proba(X[te])[:, 1]
        losses.append(log_loss(y[te], np.clip(p, 1e-6, 1 - 1e-6)))
    return float(np.mean(losses))


def export_onnx(model, n_features: int, out_path: str) -> bool:
    try:
        from onnxmltools import convert_lightgbm
        from onnxmltools.convert.common.data_types import FloatTensorType
        onnx_model = convert_lightgbm(
            model, initial_types=[("input", FloatTensorType([None, n_features]))],
            zipmap=False, target_opset=12)
        with open(out_path, "wb") as f:
            f.write(onnx_model.SerializeToString())
        return True
    except Exception as e:  # noqa: BLE001
        print(f"ONNX export failed: {e}")
        return False


def onnx_parity(onnx_path: str, X: np.ndarray, ref_prob: np.ndarray) -> dict:
    try:
        import onnxruntime as ort
        sess = ort.InferenceSession(onnx_path, providers=["CPUExecutionProvider"])
        out = sess.run(None, {"input": X.astype("float32")})
        # probabilities output (zipmap=False) is the 2nd output, shape [n,2]
        prob = out[1][:, 1] if len(out) > 1 and out[1].ndim == 2 else out[0].ravel()
        max_abs = float(np.max(np.abs(prob - ref_prob)))
        return {"ok": max_abs < 1e-4, "maxAbsDiff": max_abs}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True)
    ap.add_argument("--priors", default="datasets/derived/priors")
    ap.add_argument("--out", required=True)
    ap.add_argument("--n-estimators", type=int, default=400)
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)

    df = F.build_dataset(args.db)
    F.assert_no_forbidden_features()
    train_df, test_df = time_holdout(df)
    Xtr, ytr = F.feature_matrix(train_df)
    Xte, yte = F.feature_matrix(test_df)

    results = {}
    # Baseline 1: priors lookup
    pl = priors_lookup_predictor(args.priors)
    results["priors_lookup"] = metrics(yte, pl(test_df))
    # Baseline 2: logistic regression
    logit = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
    logit.fit(Xtr, ytr)
    results["logistic"] = metrics(yte, logit.predict_proba(Xte)[:, 1])
    # Main: LightGBM
    lgbm = train_lightgbm(Xtr, ytr, args.n_estimators)
    p_lgbm = lgbm.predict_proba(Xte)[:, 1]
    results["lightgbm"] = metrics(yte, p_lgbm)

    cv = cv_logloss(train_df, args.n_estimators)

    # ONNX export + parity
    onnx_path = os.path.join(args.out, "round_value_lgbm.onnx")
    exported = export_onnx(lgbm, len(F.FEATURE_NAMES), onnx_path)
    parity = onnx_parity(onnx_path, Xte[:200], p_lgbm[:200]) if exported else {"ok": False, "error": "not exported"}

    # Sample feature vectors + expected probs for the TS/Node parity test
    sample = {
        "featureNames": F.FEATURE_NAMES,
        "samples": [
            {"features": [float(v) for v in Xte[i]], "expectedProb": float(p_lgbm[i])}
            for i in range(0, min(10, len(Xte)))
        ],
    }
    json.dump(sample, open(os.path.join(args.out, "parity_samples.json"), "w"), indent=2)

    beat = (results["lightgbm"]["logLoss"] < min(results["priors_lookup"]["logLoss"],
                                                 results["logistic"]["logLoss"]) - 1e-4)
    summary = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "source": {"sourceId": "vct-reference", "sha256": F.sha256(args.db),
                   "rows": int(len(df)), "matches": int(df["match_id"].nunique()),
                   "trainRows": int(len(train_df)), "testRows": int(len(test_df))},
        "featureNames": F.FEATURE_NAMES,
        "mapCodes": df.attrs["map_codes"],
        "tierCodes": F.TIER_CODE,
        "split": {"method": "time_holdout(0.2 of matches) + GroupKFold(match) CV", "seed": SEED},
        "cvLogLossLightGBM": cv,
        "metrics": results,
        "lightgbmBeatsBaselines": bool(beat),
        "onnx": {"exported": exported, "path": os.path.basename(onnx_path), "parity": parity},
    }
    json.dump(summary, open(os.path.join(args.out, "metrics.json"), "w"), indent=2)
    print(json.dumps({k: results[k] for k in results}, indent=2))
    print(f"CV logloss (LightGBM): {cv:.4f}")
    print(f"LightGBM beats baselines on test log loss: {beat}")
    print(f"ONNX exported: {exported}; parity: {parity}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
