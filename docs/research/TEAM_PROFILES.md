# PROJECT V — Team Profiles (report)

**Owner:** PV-2 Data · **Date:** 2026-11-18 · **Code:** `tools/data-collector` (profiles module) ·
**Data:** `datasets/derived/team-profiles/` · **Spec:** Handoff P4 (opponent pattern learning), README §24.

> ⚠️ These are statistical **estimates** from public match economy data — not verified scouting intel.
> Tactical tendencies needing positions are left null. See ethics below before using team names.

## Goal
Team-level behavioural profiles the PV-3 IGL can use to model an opponent (and set its own tendencies):
how a team buys under economic pressure, and its side/map records.

## What the data supports (VCT Reference rounds + economy, international)
23,989 economy rounds; **70 teams** (67 with ≥5 maps). Per round we know side, start loadout tier,
winner, outcome, and both teams' ids — enough for **economic** and **side/map** tendencies. There is
**no per-round kill timeline or positions**, so tactical tendencies (site preference, execute tempo,
defaults, utility, rotations, lurk, retake-vs-save, fakes) are **null + reason**, never invented.

## Method
- **Buy tiers** on team total loadout (eco <5000, semi 5000–20000, full ≥20000; pistols = round 1/13).
  A "force buy" = buying (semi/full, not eco) in a non-pistol, non-OT round.
- **Per-game sequencing** tracks each team's loss streak and previous-round winner, so post-loss /
  post-pistol / bonus behaviours are attributed correctly.
- **Shrinkage** — each rate is Beta-binomial empirical-Bayes shrunk toward the league mean by sample
  size (pseudocount from method-of-moments on the league's team-rate spread), so small teams sit near
  average (`lowSample` flag). Each rate carries `raw`, `n`, and an `uncertainty`.
- **Point-in-time** — `as_of` filters to matches strictly before a date (no future leakage, Handoff §22.3).

## Selected league tendencies (what teams do, on average)
| Tendency | League mean | Notes |
|---|---|---|
| `forceBuyAfterLoss` | **0.89** | nearly universal (little between-team spread → low discriminating power) |
| `pistolLossForceBuy` | **0.15** | after losing a pistol, most teams eco round 2; forcing is the exception (discriminating) |
| `antiEcoFullBuy` | **0.11** | vs an eco, teams rarely full-buy — they play a lighter anti-eco to save (discriminating) |
| `bonusBuyRate` | ~1.0 | after a pistol win teams almost always spend the bonus (low info) |
| `overtimeForceBuy` | ~1.0 | OT fixed economy → everyone buys (low info) |
| `attackWinRate` | 0.48 | per-team; `defenseWinRate` 0.46 |

The discriminating economic signals are `pistolLossForceBuy` and `antiEcoFullBuy`; `forceBuyAfterLoss`,
`bonusBuyRate`, `overtimeForceBuy` are near-universal and carry little team-specific information.

## Stability (does a tendency persist season to season?)
Correlating each team's season-S rate with season-(S+1):
- `forceBuyAfterLoss`: **r ≈ −0.06** · `attackWinRate`: **r ≈ 0.17** (73 season pairs each).

**Both are weak → team tendencies are roster/meta dependent**, not stable traits. A profile is best
read as "how this roster played in this window", and should be regenerated point-in-time rather than
treated as a durable team identity. (Force-buy is also near-constant across teams, which further
suppresses its correlation.)

## Mapping to PV-3 (team-engine not yet defined on pv-core → proposed)
`origin/claude/pv-core` has no `packages/team-engine` / `TeamDecisionPolicy` yet. Proposed inputs:
| PV-3 concept | profile field |
|---|---|
| IGL economy policy — force vs save after loss | `forceBuyAfterLoss` (+ by tier), `pistolLossForceBuy` |
| anti-eco discipline | `antiEcoFullBuy` |
| opponent memory — side strength | `attackWinRate`, `defenseWinRate`, `ascentAttackWinRate`, `firstMinusSecondHalfAttack` |
| map comfort | `mapPool` |
| tactical read (site pref, tempo, …) | **null** — requires Layer-B positions |

Carry `uncertainty` so the IGL widens behaviour variance for low-sample opponents. Build the opponent
profile **as-of the match date** so the sim never uses future form.

## Ethics / name & likeness — **user decision recorded (2026-11-18)**
**Decision (2026-11-18):** not launching yet, so real team **names are committed** in `team_names.json`
(scope: **public VCT teams only**). Records stay `teamId`-keyed; names are a sibling mapping with
source (build, sha256). Tendencies remain estimates from public match economy, surfaced as such
(`provenance.notes`, meta `disclaimer`). **Pre-launch internal development use only — license and
name/likeness rights MUST be re-reviewed before any launch** (licensing, opt-in, or anonymised teams).

## Reproduce
```bash
PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \
  gen-team-profiles --db datasets/raw/vct-reference/vct.duckdb --out datasets/derived/team-profiles
cd tools/data-collector && python -m pytest -q tests/test_profiles.py
```

## Limitations / next
- Economic + side/map only; the tactical half needs Layer-B (positions).
- Several economic rates are near-universal (low team-specific info); the useful ones are pistol-loss
  response and anti-eco discipline.
- Tendencies are roster/meta dependent → prefer point-in-time profiles over a single all-time one.
