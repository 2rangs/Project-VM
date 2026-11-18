# PROJECT V — Round Value Model (evaluation report)

**Owner:** PV-2 Data · **Date:** 2026-11-18 · **Code:** `tools/ml/round-value` · **Model:** `models/round-value/`
**Spec:** README §26.3–26.4, DECISION-005 (optional enhancement; the engine runs without it).

## Question
Can we usefully estimate a round's win probability from **round-start information only**, to feed the
economy engine's Future Round Value and IGL decisions?

## Method
- **Data:** VCT Reference (real), international, 23,989 rounds / 446 matches, build 2026-11-12
  (sha `a1a189d0…`). Target: attacker wins the round (base rate 0.4997).
- **Features (17, pre-round only):** side is implicit (we predict the attacker); map, round number,
  half, OT flag, running scores + score diff, both teams' start loadout/bank + diff, loss streaks,
  previous-round result, and both buy-tier codes. See the model card for the exact list/encoding.
- **Leakage control (README §22.3–22.4):** per-game state (scores, streaks, previous result) is
  accumulated from earlier rounds only — a round's features are emitted before its result is folded
  in. A unit test flips a later round's outcome and asserts earlier rounds' features are unchanged.
- **Splits:** time holdout (most-recent 20% of matches → test) + match-grouped `GroupKFold` CV, so no
  match's rounds are split across train/test.
- **Models:** priors-lookup baseline (economy matchup table), logistic regression, LightGBM (main).
- **Metrics:** log loss, Brier, AUC, accuracy, ECE (calibration).

## Results (time holdout, 4,777 rounds)
| Model | Log loss | Brier | AUC | Accuracy | ECE |
|---|---|---|---|---|---|
| Priors lookup | 0.6317 | 0.2221 | 0.672 | 61.4% | **0.012** |
| Logistic regression | **0.6234** | **0.2179** | **0.693** | **62.2%** | 0.020 |
| LightGBM | 0.6318 | 0.2220 | 0.680 | 61.8% | 0.032 |

LightGBM CV log loss 0.6331.

## Conclusion
**LightGBM does not beat the baselines.** The gains from a gradient-boosted model over a logistic
regression — or even a plain economy-matchup lookup — are within noise, and the lookup is the best
calibrated. Pre-round state is only weakly predictive (~62% accuracy, AUC ~0.69), matching published
round-start models (~61%). This is expected: most of a round is decided by in-round play, which these
features deliberately exclude.

**Recommendation (DECISION-005):** do **not** adopt the LightGBM model as a dependency. Use the
economy-matchup **priors lookup** already in `@pv/economy-engine` (it is essentially as good and needs
no model file or runtime). The ONNX export and the TypeScript `RoundValueModel` seam are kept so the
model can be swapped in later if a richer feature set (positions, agent comps) makes it worthwhile.

## Deployment seam
- `RoundValueModel` (`packages/economy-engine/src/round-value-model.ts`): `createRoundValueModel({
  modelPath? })` → `predict(features): Promise<number>`. Loads the ONNX via the **optional**
  `onnxruntime-node` dependency when present; otherwise falls back to the priors lookup. Never throws.
- Python↔ONNX parity: max abs diff 1.3e-7. Node↔ONNX parity: verified in
  `packages/economy-engine/test/round-value.test.ts` (tol 1e-3).
- `onnxruntime-node` install note: its postinstall tries to fetch a CUDA EP; install with
  `npm install --onnxruntime-node-install-cuda=skip onnxruntime-node` in this CPU environment.

## Reproduce
```bash
pip install -e 'tools/ml/round-value[onnx,dev]'
PYTHONPATH=tools/ml/round-value/src python -m pv_round_value.train \
  --db datasets/raw/vct-reference/vct.duckdb --priors datasets/derived/priors --out models/round-value
cd tools/ml/round-value && python -m pytest -q
```

## Next
- Re-evaluate once Layer-B (positions) or agent-composition features exist — that is where a
  non-linear model might finally beat the lookup.
- Per-patch / per-era models using the retained `season`/`patch` columns.
