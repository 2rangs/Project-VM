# PROJECT V — Simulation Validation Report

- Generated: 2026-11-24T06:51:32+00:00  ·  scope: `ascent`
- Baselines: VCT Reference priors (a1a189d0ec7d9a71…)
- Sim meta: `{"synthetic": true, "label": "good-matches-ascent-baselines", "rounds": 200}`
- **7/7 judged metrics passed** (51 reported-only)

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
| economy | metric=plan_win, plan=full | 0.500 | — | — | — | report-only |
| economy | metric=tier_share, plan=eco | 0.000 | 0.054 | — | — | report-only |
| economy | metric=tier_share, plan=full | 1.000 | 0.621 | — | — | report-only |
| economy | metric=tier_share, plan=semi | 0.000 | 0.326 | — | — | report-only |
| round_duration_ms | — | 60000ms | — | — | — | report-only |
| first_kill_time_s | stat=mean | 15.0s | — | — | — | report-only |
| first_kill_time_s | stat=p10 | 15.0s | — | — | — | report-only |
| first_kill_time_s | stat=p50 | 15.0s | — | — | — | report-only |
| first_kill_time_s | stat=p90 | 15.0s | — | — | — | report-only |
| first_kill_early | within_s=15 | 1.000 | — | — | — | report-only |
| flawless_rounds | — | 0.000 | — | — | — | report-only |
| round_duration_s | stat=mean | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p10 | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p50 | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p90 | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p50, outcome=bomb_detonated | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p50, outcome=defuse | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p50, outcome=elimination | 60.0s | — | — | — | report-only |
| round_duration_s | stat=p50, outcome=time_expired | 60.0s | — | — | — | report-only |
| plant_to_end_s | stat=mean | — | — | — | — | report-only |
| plant_to_end_s | stat=p10 | — | — | — | — | report-only |
| plant_to_end_s | stat=p50 | — | — | — | — | report-only |
| plant_to_end_s | stat=p90 | — | — | — | — | report-only |
| trade_rate_3s | window_ms=3000 | 0.500 | — | — | — | report-only |
| post_plant | measure=plant_rate | 0.000 | 0.601 | [0.583,0.618] | — | report-only |
| post_plant | measure=post_plant_attack_win | — | 0.738 | [0.718,0.757] | — | report-only |
| post_plant | measure=post_plant_detonation | — | 0.140 | [0.125,0.157] | — | report-only |
| post_plant_by_advantage | attackers_minus_defenders=-2 or worse | — | — | — | — | report-only |
| post_plant_by_advantage | attackers_minus_defenders=-1 | — | — | — | — | report-only |
| post_plant_by_advantage | attackers_minus_defenders=0 | — | — | — | — | report-only |
| post_plant_by_advantage | attackers_minus_defenders=+1 | — | — | — | — | report-only |
| post_plant_by_advantage | attackers_minus_defenders=+2 or better | — | — | — | — | report-only |
| clutch_win_rate | x=1v1 | — | — | — | — | report-only |
| clutch_win_rate | x=1v2 | — | — | — | — | report-only |
| clutch_win_rate | x=1v3 | — | — | — | — | report-only |
| clutch_win_rate | x=1v4 | — | — | — | — | report-only |
| clutch_win_rate | x=1v5 | — | — | — | — | report-only |
| clutch_wins_per_round | x=1v1 | 0.000 | 0.086 | [0.077,0.097] | — | report-only |
| clutch_wins_per_round | x=1v2 | 0.000 | 0.051 | [0.044,0.059] | — | report-only |
| clutch_wins_per_round | x=1v3 | 0.000 | 0.011 | [0.008,0.015] | — | report-only |
| clutch_wins_per_round | x=1v4 | 0.000 | 0.002 | [0.001,0.005] | — | report-only |
| clutch_wins_per_round | x=1v5 | 0.000 | 0.000 | [0.000,0.002] | — | report-only |
| clutch_wins_per_round | x=any | 0.000 | 0.150 | [0.138,0.163] | — | report-only |
| kast | side=all | 1.000 | 0.711 | [0.706,0.716] | — | report-only |
| kast | side=attack | 1.000 | 0.687 | [0.679,0.694] | — | report-only |
| kast | side=defense | 1.000 | 0.734 | [0.727,0.741] | — | report-only |
