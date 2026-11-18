"""Small, dependency-free statistics helpers for the priors ETL.

Kept pure and separately testable (hand-computed expectations in tests).
"""

from __future__ import annotations

import math
import random

# Standard-normal quantile for a 95% two-sided interval.
Z_95 = 1.959963984540054


def wilson_interval(successes: int, n: int, z: float = Z_95) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion. Returns (low, high) in [0,1].

    Preferred over normal approximation for small n / extreme rates. For n=0 returns (0, 1).
    """
    if n <= 0:
        return (0.0, 1.0)
    p = successes / n
    z2 = z * z
    denom = 1.0 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = (z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def cluster_bootstrap_rate(
    groups: dict[str, tuple[int, int]],
    iterations: int = 2000,
    seed: int = 20260101,
    z_percentiles: tuple[float, float] = (2.5, 97.5),
) -> tuple[float, float] | tuple[None, None]:
    """Cluster (match-level) bootstrap CI for an overall success rate.

    `groups` maps a cluster id (match_id) -> (successes, n) within that cluster. Resampling whole
    clusters with replacement respects the correlation between rounds of the same match
    (Handoff §22.4). Returns (low, high) percentile bounds, or (None, None) if < 2 clusters.
    """
    keys = list(groups)
    if len(keys) < 2:
        return (None, None)
    rng = random.Random(seed)
    rates = []
    k = len(keys)
    for _ in range(iterations):
        succ = tot = 0
        for _ in range(k):
            s, n = groups[keys[rng.randrange(k)]]
            succ += s
            tot += n
        if tot:
            rates.append(succ / tot)
    if not rates:
        return (None, None)
    rates.sort()

    def pct(p):
        idx = min(len(rates) - 1, max(0, int(round(p / 100 * (len(rates) - 1)))))
        return rates[idx]

    return (pct(z_percentiles[0]), pct(z_percentiles[1]))
