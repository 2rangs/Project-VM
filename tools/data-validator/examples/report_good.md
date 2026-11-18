# PROJECT V — Simulation Validation Report

- Generated: 2026-11-18T09:35:45+00:00  ·  scope: `ascent`
- Baselines: VCT Reference priors (a1a189d0ec7d9a71…)
- Sim meta: `{"synthetic": true, "label": "good-matches-ascent-baselines", "rounds": 200}`
- **7/7 judged metrics passed** (6 reported-only)

| Metric | Dims | Sim | Real | Real 95% CI | Tol | Result |
|---|---|---|---|---|---|---|
| round_outcome_distribution | outcome=elimination | 0.720 | 0.714 | [0.699,0.730] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=bomb_detonated | 0.080 | 0.082 | [0.074,0.092] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=defuse | 0.160 | 0.160 | [0.148,0.173] | ±0.04 | ✅ PASS |
| round_outcome_distribution | outcome=time_expired | 0.040 | 0.043 | [0.037,0.051] | ±0.04 | ✅ PASS |
| side_winrate | side=attack, phase=all | 0.500 | 0.509 | [0.491,0.527] | ±0.04 | ✅ PASS |
| opening_duel | side=attack | 0.440 | 0.437 | [0.420,0.454] | ±0.04 | ✅ PASS |
| economy_matchup | ownBuy=full, oppBuy=full | 0.500 | 0.500 | [0.479,0.521] | ±0.05 | ✅ PASS |
| man_advantage | state=4v4 | 0.500 | — | — | — | report-only |
| man_advantage | state=4v5 | 0.107 | — | — | — | report-only |
| man_advantage | state=5v4 | 1.000 | — | — | — | report-only |
| man_advantage | state=5v5 | 0.500 | — | — | — | report-only |
| trade_rate | — | 0.500 | — | — | — | report-only |
| round_duration_ms | — | 60000ms | — | — | — | report-only |
