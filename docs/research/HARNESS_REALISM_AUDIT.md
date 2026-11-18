# PROJECT V — Validation Harness Realism Audit (2026-11-18)

Why `sim-batch` reports attack win ~0.62 (real Ascent ≈ 0.509), and whether the harness metrics are
measured the **same way** as the real VCT baselines. Prompted by PV-3's isolation finding that the
0.62 comes from **scenario structure, not policy** (ScriptedPolicy vs ScriptedPolicy ≈ 0.633).

## 1. Root cause of the attack skew: defender placement + no utility
The simulated round (round-simulator `makeSyntheticRound`, used by `@pv/match-runner`) places all five
defenders **stacked on sites / fixed**: `def1,def2 → a-site`, `def3,def4 → b-site`, `def5 → mid-courtyard`,
and the Match Runner calls it **without `withAbilities`**, so there is **no utility at all** (no smokes,
flashes, mollies, recon or sentinel traps). Real VCT rounds always have full agent utility and defenders
holding **forward** (A Main, B Main), contesting **mid**, and set in **crossfires**. With defenders sitting
on the site and no utility to deny space, attackers reach a site and make a 5v2 — hence the inflated
attack win rate and opening-duel rate. This is a **harness-realism** gap, not an engine or policy bug.

**Fix (this task):** diversified, forward defensive setups as data + enabling utility (see §3–§4).

## 2. Measurement-definition parity vs the real baselines
Each judged metric was checked against how its real prior is computed (VCT Reference ETL,
`tools/data-collector`), to confirm we compare like with like.

| Metric | Sim definition | Real (prior) definition | Same? |
|---|---|---|---|
| `side_winrate` (attack, phase=all) | attack wins ÷ all rounds in the batch | `side_map_baselines` attack = attack-won ÷ **all** rounds (both halves, **incl. pistol & eco**) | ✅ same population — both include pistol/eco and all buy types |
| `round_outcome_distribution` | sim `roundEnd.reason` → {elimination, bomb_detonated (spikeDetonation), defuse (spikeDefused), time_expired (timeExpired)} | VCT `rounds.outcome` enum: elimination / bomb_detonated / defuse / time_expired | ✅ taxonomy maps 1:1 |
| `opening_duel` (attack) | side of the **first kill** of the round ÷ rounds with ≥1 kill | `combat_opening_duel` attack = attacker first-blood ÷ opening duels (first contact) | ✅ structurally same (first blood by side); both drop no-kill rounds |
| `economy_matchup` | (attackerTier, defenderTier) → attack win; tiers pistol/full/force/eco | VCT economy-matchup cells, tiers full/semi/eco/pistol | ⚠️ partial — sim emits **`force`** (no real cell → reported-only); `semi` not produced by the sim's buy logic |

**Definitions match** for the four judged families (round population, outcome taxonomy, first-blood).
The comparison is apples-to-apples *in definition*.

## 3. The real caveat: comparison **conditions** differ (document, don't silently compare)
Even with matched definitions, the current sim and the real baselines differ in **conditions**:

- **Utility.** Real VCT always has full agent utility; the sim currently runs with **none**
  (`withAbilities` off). Smokes/flashes/mollies/recon/traps are a first-order driver of site control and
  entry success, so a no-utility sim is not calibrated to real rates — it is **directional** only.
- **Defender geometry.** Real defenses vary setup round to round (anchors, forward holds, mid control,
  retakes, rotates); the sim used one fixed stacked layout.
- **Skill model.** The sim uses team-aggregate skills with combat-only mechanics; real rounds include
  comms, mid-round adaptation and ability timing the sim does not model.

**Reporting rule:** until utility is on **and** setups are diversified, `sim-batch` numbers should be read
as *trend vs the committed baseline* (via `--compare`), **not** as calibrated to the real point estimates.
This note travels with the baseline docs.

## 4. Deliverable: diversified defensive setups (data)
`datasets/synthetic/setups/ascent-defense.json` (schema `datasets/schema/defense-setup.schema.json`)
defines **3 setups** on real PV-4 navgraph zones, grounded in PV-1's tactical KB
(`datasets/derived/tactics/ascent-tactics.json`):

| Setup | Layout | Defenders |
|---|---|---|
| `standard-2-1-2` (weight 2) | balanced default | a-site, **a-main**, mid-courtyard, b-site, **b-main** |
| `a-stack-3-1-1` | stack A | a-site, a-main, **a-tree**, mid-courtyard, b-site |
| `mid-control-2-2-1` | heavy mid | a-site, a-main, mid-courtyard, **mid-catwalk**, b-site |

Each defender carries an optional `abilityId` from the sim catalog (omen smoke / sova recon / brim molly).
The Match Runner selects one setup per round by seed (deterministic). These replace the stacked fixed
layout with forward holds, mid control and crossfires, so attackers no longer walk into a 5v2.

## 5. Needs PV-3/PV-4 code (requested separately)
Setups are data; **consuming** them requires a Match Runner change (match-runner is PV-3-owned). The
round-execution API already supports it: `round-simulator` `runMatchRound` takes per-player
`spawnZoneId` + ability loadout (`packages/round-simulator/src/match-round.ts`). The request to PV-3:
1. In `match.ts`, load `datasets/synthetic/setups/ascent-defense.json`, pick a setup per round by the
   round seed (weighted), and assign each defender's `spawnZoneId` (+ ability) accordingly — via
   `runMatchRound`, or by extending `makeSyntheticRound` with a `defenderZones` option.
2. Enable utility for both teams (`withAbilities`) so the comparison condition matches real VCT.

## 6. Before / after
- **Before** (fixed stacked layout, no utility, baseline-era engine): attack win **0.197** (pre-fix) →
  **0.617** after PV-3/PV-4's round-engine fix (overshooting real 0.509); time_expired 0.000.
- **After** (diversified setups + utility): to be measured once PV-3 wires the setups; re-run
  `sim-batch --compare docs/research/SIM_BASELINE_2026-11-18.json` and record the move toward 0.509.
