# PROJECT V — Simulation Validation Report

- Generated: 2026-11-23T02:54:48+00:00  ·  scope: `ascent`
- Baselines: VCT Reference priors (a1a189d0ec7d9a71…)
- Sim meta: `{"synthetic": true, "label": "sim-batch 160 matches (seeds 161..320, Ascent)", "rounds": 3440, "matches": 160, "map": "Ascent", "seedStart": 161, "generatedAt": "2026-11-23T02:54:46.304Z"}`
- **8/8 judged metrics passed** (40 reported-only)

| Metric | Dims | Sim | Real | Real 95% CI | Tol | Result |
|---|---|---|---|---|---|---|
| round_outcome_distribution | outcome=elimination | 0.725 | 0.714 | [0.699,0.730] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=bomb_detonated | 0.098 | 0.082 | [0.074,0.092] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=defuse | 0.141 | 0.160 | [0.148,0.173] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=time_expired | 0.037 | 0.043 | [0.037,0.051] | ±0.04 | ✅ PASS |
| side_winrate | side=attack, phase=all | 0.535 | 0.509 | [0.491,0.527] | ±0.04 | ✅ PASS |
| opening_duel | side=attack | 0.472 | 0.437 | [0.420,0.454] | ±0.04 | ✅ PASS |
| economy_matchup | ownBuy=pistol, oppBuy=pistol | 0.512 | 0.500 | [0.459,0.541] | ±0.05 | ✅ PASS |
| economy_matchup | ownBuy=full, oppBuy=force | 0.887 | — | — | ±0.05 | report-only |
| economy_matchup | ownBuy=full, oppBuy=full | 0.508 | 0.500 | [0.479,0.521] | ±0.05 | ✅ PASS |
| economy_matchup | ownBuy=force, oppBuy=full | 0.120 | — | — | ±0.05 | report-only |
| economy_matchup | ownBuy=force, oppBuy=force | 0.600 | — | — | ±0.05 | report-only |
| man_advantage | state=0v1 | 0.022 | — | — | — | report-only |
| man_advantage | state=0v2 | 0.015 | — | — | — | report-only |
| man_advantage | state=0v3 | 0.000 | — | — | — | report-only |
| man_advantage | state=0v4 | 0.000 | — | — | — | report-only |
| man_advantage | state=0v5 | 0.000 | — | — | — | report-only |
| man_advantage | state=1v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=1v1 | 0.563 | — | — | — | report-only |
| man_advantage | state=1v2 | 0.262 | — | — | — | report-only |
| man_advantage | state=1v3 | 0.096 | — | — | — | report-only |
| man_advantage | state=1v4 | 0.025 | — | — | — | report-only |
| man_advantage | state=1v5 | 0.002 | — | — | — | report-only |
| man_advantage | state=2v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=2v1 | 0.882 | — | — | — | report-only |
| man_advantage | state=2v2 | 0.656 | — | — | — | report-only |
| man_advantage | state=2v3 | 0.351 | — | — | — | report-only |
| man_advantage | state=2v4 | 0.135 | — | — | — | report-only |
| man_advantage | state=2v5 | 0.043 | — | — | — | report-only |
| man_advantage | state=3v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=3v1 | 0.967 | — | — | — | report-only |
| man_advantage | state=3v2 | 0.862 | — | — | — | report-only |
| man_advantage | state=3v3 | 0.636 | — | — | — | report-only |
| man_advantage | state=3v4 | 0.364 | — | — | — | report-only |
| man_advantage | state=3v5 | 0.162 | — | — | — | report-only |
| man_advantage | state=4v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=4v1 | 0.995 | — | — | — | report-only |
| man_advantage | state=4v2 | 0.953 | — | — | — | report-only |
| man_advantage | state=4v3 | 0.810 | — | — | — | report-only |
| man_advantage | state=4v4 | 0.582 | — | — | — | report-only |
| man_advantage | state=4v5 | 0.339 | — | — | — | report-only |
| man_advantage | state=5v0 | 1.000 | — | — | — | report-only |
| man_advantage | state=5v1 | 1.000 | — | — | — | report-only |
| man_advantage | state=5v2 | 0.992 | — | — | — | report-only |
| man_advantage | state=5v3 | 0.910 | — | — | — | report-only |
| man_advantage | state=5v4 | 0.754 | — | — | — | report-only |
| man_advantage | state=5v5 | 0.535 | — | — | — | report-only |
| trade_rate | — | 0.490 | — | — | — | report-only |
| round_duration_ms | — | 47419ms | — | — | — | report-only |
