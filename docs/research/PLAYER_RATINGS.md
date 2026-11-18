# PROJECT V — Player Ratings (estimation report)

**Owner:** PV-2 Data · **Date:** 2026-11-18 · **Code:** `tools/data-collector` (ratings module) ·
**Data:** `datasets/derived/ratings/` · **Spec:** README §23 (player AI), §07 (player intelligence).

> ⚠️ **These are statistical ESTIMATES derived from public professional match box scores. They are
> NOT assessments of real players' ability.** Attributes the data cannot support are left null, never
> invented. See the ethics section before using names.

## Goal
Turn VCT Reference per-player stats into the engine's player attributes (README §23.1:
Mechanical / Tactical / Mental / Team / Specialization), **with uncertainty**, for:
- PV-4 `@pv/combat-engine` `CombatSkills` (mechanical skills in [0,1]), and
- PV-3 player-policy tendencies (aggression, trading, clutch).

## Available stats (VCT Reference `player_map`, international)
ACS, ADR, KAST, HS%, K/D/A, **FK/FD** (opening duels), multikills, **clutches won** (1v1–1v5),
econ, plants, defuses, agents, each split overall/attack/defense. 402 international players, median
16 maps, 195 multi-season.
**Not present:** positions, movement traces, utility outcomes, comms, per-round weapon choice,
reaction-time, clutch *attempts* (only wins). Attributes needing these are left null (below).

## Method
1. **Aggregate** per player across maps (means; opening-duel win rate = ΣFK/(ΣFK+ΣFD)); role from the
   agents played (duelist/initiator/controller/sentinel; newer agents → `unknown`, not guessed).
2. **Shrinkage (empirical Bayes).** Each underlying stat is pulled toward the league mean by sample
   size: `shrunk = μ + n/(n+k)·(raw − μ)`, with `k = within-map variance / between-player variance`
   estimated from the data. Few-map players sit near average (`lowSample` flag).
3. **Role correction.** Role-driven stats (opening-duel rate, first-kills-per-map) are ranked **within
   role**, so a duelist's naturally high entry rate isn't mistaken for superior reaction.
4. **Scale.** Shrunk stats → league (or role) percentile → `skill = 0.35 + 0.5·percentile`, so the
   median maps to **0.6** (the combat engine's `AVERAGE_SKILLS`).
5. **Uncertainty.** Every estimate carries an `uncertainty` half-width (wider when shrunk hard or from
   a weak proxy) and `proxyConfidence` (how direct the stat→attribute link is).

### Stat → attribute mapping (explainable)
| Attribute | From | Proxy confidence |
|---|---|---|
| `aim` | ACS + ADR (percentile blend) | 0.8 |
| `crosshairPlacement` | HS% | 0.9 |
| `firstBulletAccuracy` | HS% + opening-duel win rate | 0.6 |
| `reaction` | opening-duel win rate (**role-relative**) | 0.6 |
| `tracking` | ADR | 0.4 (weak — see redundancy) |
| `impact` | VLR Rating 2.0 | 0.9 |
| `entryAggression` | first-kills/map (**role-relative**) | 0.8 |
| `trading` | KAST | 0.6 |
| `clutch` | clutches won/map | 0.4 (no attempts denominator) |
| `consistency` | inverse across-map rating std | 0.6 |

### Null attributes (not estimable from a box score)
`movement, weaponControl, positioning, utilityUsage, mapAwareness, rotations, communication,
teamworkDiscipline, lurking, anchoring, weaponPreference, agentMastery` — each stored as
`{value: null, reason: ...}`. They need Layer-B positional/replay/comms data PROJECT V does not have.

## Validation
- **Shrinkage reduces next-season error** (time split: estimate from earlier seasons → predict the
  latest season). Rating MSE **0.0292 → 0.0273**; ACS MSE **1106 → 1002** (both `shrinkageHelps:true`,
  ~189–195 multi-season players). So the shrinkage earns its place.
- **Redundancy check (attribute correlations).** The pipeline flags `aim ~ tracking` at **r = 0.99** —
  `tracking` (from ADR) is essentially a duplicate of `aim` (from ACS+ADR). **Treat `tracking` as a
  low-confidence, non-independent proxy**, not a separate skill. Other notable correlations:
  `aim~impact` 0.79, `crosshairPlacement~firstBulletAccuracy` 0.74 (expected, both from HS%).
- All estimated attributes centre on 0.6 by construction; 12 attributes are null for all players.

## Mapping to downstream packages (read-only references)
**PV-4 `@pv/combat-engine` `CombatSkills` ([0,1])** — direct:
| CombatSkills field | ratings attribute |
|---|---|
| `aim` | `aim` |
| `crosshairPlacement` | `crosshairPlacement` |
| `firstBulletAccuracy` | `firstBulletAccuracy` |
| `reaction` | `reaction` |
| `tracking` | `tracking` (low confidence — or reuse `aim`) |
| `movement` | **null** → use `AVERAGE_SKILLS.movement` (0.6) until Layer B |
| `weaponControl` | **null** → use `AVERAGE_SKILLS.weaponControl` (0.6) until Layer B |

> Positioning/information advantages are modelled by the combat engine's `EngagePosture`, **not** by a
> skill rating — consistent with README §29 (ratings cannot override an information deficit).

**PV-3 `PlayerProfile`** (now defined: `shared-types/src/decision-policy.ts`, consumed by
`@pv/team-engine` `TeamDecisionPolicy({ profiles })`; `igl.ts` sorts entries by `profile.aggression`).
All fields are [0,1], neutral 0.5 — our ratings median is 0.6, so subtract ~0.1 (or map percentile→
`0.25+0.5·p`) when filling a profile:
| PlayerProfile field | ratings attribute | note |
|---|---|---|
| `aggression` (risky peeks/entries) | `entryAggression` | direct |
| `discipline` (follows team orders) | `consistency` | proxy (low rating variance ≈ disciplined) |
| `decisionMaking` (avoids bad fights) | `impact` | proxy (VLR rating) |
| `teamwork` (timing alignment) | `trading` | proxy (KAST / trade participation) |

Carry `uncertainty` so the policy can widen behaviour variance for low-sample players. (Mechanical
attributes go to the combat engine's `CombatSkills`, above — `PlayerProfile` is behavioural only.)

## Ethics / name & likeness  — **user decision recorded (2026-11-18)**
- **Decision (2026-11-18):** not launching yet, so real player **handles are committed** in
  `player_names.json`. Scope is **public VCT professional players only** (no private individuals).
- Records stay `playerId`-keyed; the handle mapping is a sibling file with its source (build, sha256).
- Attributes remain estimates from public stats, surfaced as such (`provenance.notes`, meta
  `disclaimer`) — **not** objective skill ratings of real people.
- **Pre-launch internal development use only. License and name/likeness rights MUST be re-reviewed
  before any launch** (options: licensing, opt-in, or anonymised/fictional rosters).

## Reproduce
```bash
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  gen-ratings --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/ratings
cd tools/data-collector && python -m pytest -q tests/test_ratings.py
```

## Limitations / next
- Box-score only → mechanical + a few derived attributes; the tactical/positional half is absent.
- `clutch` has no attempts denominator (wins only) → weak; `tracking` is redundant with `aim`.
- Pooled across 2021–2026 patches/metas. Re-estimate per era or per role as needed.
- The honest ceiling here is low; richer attributes need Layer-B (positions) data.
