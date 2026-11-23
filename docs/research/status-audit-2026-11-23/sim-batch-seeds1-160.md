# PROJECT V — Simulation Validation Report

- Generated: 2026-11-23T02:54:57+00:00  ·  scope: `ascent`
- Baselines: VCT Reference priors (a1a189d0ec7d9a71…)
- Sim meta: `{"synthetic": true, "label": "sim-batch 160 matches (seeds 1..160, Ascent)", "rounds": 3383, "matches": 160, "map": "Ascent", "seedStart": 1, "generatedAt": "2026-11-23T02:54:56.591Z"}`
- **8/8 judged metrics passed** (40 reported-only)

| Metric | Dims | Sim | Real | Real 95% CI | Tol | Result |
|---|---|---|---|---|---|---|
| round_outcome_distribution | outcome=elimination | 0.704 | 0.714 | [0.699,0.730] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=bomb_detonated | 0.106 | 0.082 | [0.074,0.092] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=defuse | 0.148 | 0.160 | [0.148,0.173] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=time_expired | 0.042 | 0.043 | [0.037,0.051] | ±0.04 | ✅ PASS |
| side_winrate | side=attack, phase=all | 0.521 | 0.509 | [0.491,0.527] | ±0.04 | ✅ PASS |
| opening_duel | side=attack | 0.462 | 0.437 | [0.420,0.454] | ±0.04 | ✅ PASS |
| economy_matchup | ownBuy=pistol, oppBuy=pistol | 0.528 | 0.500 | [0.459,0.541] | ±0.05 | ✅ PASS |
| economy_matchup | ownBuy=force, oppBuy=full | 0.108 | — | — | ±0.05 | report-only |
| economy_matchup | ownBuy=full, oppBuy=full | 0.495 | 0.500 | [0.479,0.521] | ±0.05 | ✅ PASS |
| economy_matchup | ownBuy=full, oppBuy=force | 0.868 | — | — | ±0.05 | report-only |
| economy_matchup | ownBuy=force, oppBuy=force | 0.500 | — | — | ±0.05 | report-only |
| man_advantage | state=0v1 | 0.020 | — | — | — | report-only |
| man_advantage | state=0v2 | 0.004 | — | — | — | report-only |
| man_advantage | state=0v3 | 0.000 | — | — | — | report-only |
| man_advantage | state=0v4 | 0.000 | — | — | — | report-only |
| man_advantage | state=0v5 | 0.000 | — | — | — | report-only |
| man_advantage | state=1v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=1v1 | 0.540 | — | — | — | report-only |
| man_advantage | state=1v2 | 0.259 | — | — | — | report-only |
| man_advantage | state=1v3 | 0.089 | — | — | — | report-only |
| man_advantage | state=1v4 | 0.023 | — | — | — | report-only |
| man_advantage | state=1v5 | 0.006 | — | — | — | report-only |
| man_advantage | state=2v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=2v1 | 0.841 | — | — | — | report-only |
| man_advantage | state=2v2 | 0.615 | — | — | — | report-only |
| man_advantage | state=2v3 | 0.345 | — | — | — | report-only |
| man_advantage | state=2v4 | 0.135 | — | — | — | report-only |
| man_advantage | state=2v5 | 0.037 | — | — | — | report-only |
| man_advantage | state=3v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=3v1 | 0.975 | — | — | — | report-only |
| man_advantage | state=3v2 | 0.844 | — | — | — | report-only |
| man_advantage | state=3v3 | 0.616 | — | — | — | report-only |
| man_advantage | state=3v4 | 0.361 | — | — | — | report-only |
| man_advantage | state=3v5 | 0.122 | — | — | — | report-only |
| man_advantage | state=4v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=4v1 | 0.994 | — | — | — | report-only |
| man_advantage | state=4v2 | 0.950 | — | — | — | report-only |
| man_advantage | state=4v3 | 0.803 | — | — | — | report-only |
| man_advantage | state=4v4 | 0.589 | — | — | — | report-only |
| man_advantage | state=4v5 | 0.311 | — | — | — | report-only |
| man_advantage | state=5v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=5v1 | 1.000 | — | — | — | report-only |
| man_advantage | state=5v2 | 0.990 | — | — | — | report-only |
| man_advantage | state=5v3 | 0.922 | — | — | — | report-only |
| man_advantage | state=5v4 | 0.765 | — | — | — | report-only |
| man_advantage | state=5v5 | 0.521 | — | — | — | report-only |
| trade_rate | — | 0.503 | — | — | — | report-only |
| round_duration_ms | — | 49115ms | — | — | — | report-only |
