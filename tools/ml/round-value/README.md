# pv-round-value

Pre-round **round-value model** (attacker win probability from round-start info only). Baselines
(priors lookup, logistic) vs LightGBM, exported to ONNX. **Finding: LightGBM does not beat the
baselines** — see [`docs/research/ROUND_VALUE_MODEL.md`](../../../docs/research/ROUND_VALUE_MODEL.md)
and [`models/round-value/model_card.md`](../../../models/round-value/model_card.md). Kept as an
optional (DECISION-005) seam, not an adopted dependency.

```bash
pip install -e 'tools/ml/round-value[onnx,dev]'
# train + evaluate + export ONNX
PYTHONPATH=tools/ml/round-value/src python -m pv_round_value.train \
  --db datasets/raw/vct-reference/vct.duckdb --priors datasets/derived/priors --out models/round-value
# tests (feature leakage guard + split + metrics)
cd tools/ml/round-value && python -m pytest -q
```

- `src/pv_round_value/features.py` — pre-round features, leakage-guarded; `FEATURE_NAMES` is the
  contract shared with the ONNX model and the TS `RoundValueModel`.
- `src/pv_round_value/train.py` — splits (time holdout + match GroupKFold), models, metrics
  (log loss / Brier / AUC / ECE), ONNX export + parity.
