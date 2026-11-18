# Model Card — Round Value (pre-round win probability)

**Model:** `round_value_lgbm.onnx` (LightGBM binary classifier) · **Owner:** PV-2 Data · **Date:** 2026-11-18
**Status:** v0 — **NOT recommended for adoption over the baseline** (see Evaluation).

## What it does
Estimates the **attacking team's probability of winning a round** from **round-start information only**.
Intended as an optional (DECISION-005) input to the economy engine's Future Round Value and to IGL
logic. The engine must work without it (heuristic / priors fallback).

## Training data
- Source: **VCT Reference** `vct.duckdb`, sha256 `a1a189d0ec7d9a71d7586645a3ce5d39bfea719c2f782bb287a23a300cea4890`, build 2026-11-12.
- International events only, rounds with recorded economy and a known winner.
- Rows: **23,989** rounds · **446** matches · 1,125 maps · base rate attacker win **0.4997**.
- Split: **time holdout** (most-recent 20% of matches by date → 4,777 test rows) + match-grouped
  `GroupKFold` CV. No round of a match is split across train/test; no future info reaches a past
  prediction (README §22.3–22.4). Leakage is structurally enforced and unit-tested
  (`tools/ml/round-value/tests/test_features.py::test_no_future_leakage`).

## Features (17, pre-round only — order is load-bearing)
`round_num, is_ot, half_index, atk_score, def_score, score_diff, atk_loadout, def_loadout,
loadout_diff, atk_bank, def_bank, atk_streak_losses, def_streak_losses, prev_atk_won, map_code,
atk_tier_code, def_tier_code`.
- Categoricals encoded as integer codes: `tierCodes = {pistol:3, eco:0, semi:1, full:2}`;
  `mapCodes` in `metrics.json`. The ONNX input is a single `float32[1,17]` in this order.
- **Excluded (anti-leakage):** round winner/outcome, any in-round event, final match result, future
  rounds. `season`/`patch` are kept as metadata/split columns, not features.

## Evaluation (time holdout)
| Model | Log loss | Brier | AUC | Accuracy | ECE |
|---|---|---|---|---|---|
| Priors lookup (economy matchup) | 0.6317 | 0.2221 | 0.672 | 61.4% | **0.012** |
| Logistic regression | **0.6234** | **0.2179** | **0.693** | **62.2%** | 0.020 |
| **LightGBM** (this model) | 0.6318 | 0.2220 | 0.680 | 61.8% | 0.032 |

LightGBM CV log loss: 0.6331.

**Conclusion: LightGBM does NOT beat the baselines.** Logistic regression is marginally best on log
loss/AUC; the simple priors lookup is best calibrated and nearly as accurate. Pre-round state is only
weakly predictive (~62% accuracy, AUC ~0.69) — consistent with published round-start models
(~61%). Per DECISION-005, **not adopting the model is the recommendation**: use the economy-matchup
priors lookup (already in `@pv/economy-engine`). The ONNX is shipped to exercise the integration seam
and for future re-training, not because it improves accuracy.

## ONNX
- `round_value_lgbm.onnx` — converted with `onnxmltools` (opset 12, zipmap=false). Input `input:
  float32[None,17]`; outputs a label and a `[None,2]` probability tensor (take column 1).
- Python↔ONNX parity verified: max abs diff **1.3e-7** (`metrics.json.onnx.parity`).
- TS/Node parity verified against `onnxruntime-node` in
  `packages/economy-engine/test/round-value.test.ts` (tolerance 1e-3) using `parity_samples.json`.

## Limitations
- Pre-round only — ignores all in-round play; a weak predictor by design.
- Trained across 2021–2026 patches pooled; agent pools / economy rules shifted. Regenerate per era
  with the `season`/`patch` columns if needed.
- No positional/combat features (VCT Reference has none).
- Not recalibrated per patch.

## License / provenance
Derived statistic from VCT Reference (free to use incl. commercial, attribution appreciated; no
redistribution clause — see `datasets/raw/vct-reference/SOURCE.json`). Code MIT. Model weights are a
transformation of public pro-match stats; distributed with this repo.
