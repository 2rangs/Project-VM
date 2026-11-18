"""PROJECT V — pre-round round-value model.

A small, optional (DECISION-005) model that estimates attacker round win probability from
round-START information only. Baselines (priors lookup, logistic regression) and a LightGBM main
model, exported to ONNX for the TypeScript inference path. Leakage-guarded (README §22.3-22.4).
"""

from . import features  # noqa: F401

__all__ = ["features"]
__version__ = "0.1.0"
