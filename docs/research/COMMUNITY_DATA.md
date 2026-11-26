# PROJECT V — Community-sourced VCT statistics (COMMUNITY_DATA.md)

**Author:** session J (`claude/pv3-community-data`) · **Date:** 2026-11-26 · **Status:** 1st collection pass
**Data:** [`datasets/community/vct_community_stats.json`](../../datasets/community/vct_community_stats.json)
(schema `vct_community_stats.schema.json`) · **Tool:** [`tools/community-collect/`](../../tools/community-collect/)

Goal (HANDOFF §5 **P2-11**): `vct.duckdb` has match/round **results** and player stats but **no positions,
events, or plant coordinates**, so the engine cannot derive man-advantage win rates, first-kill-zone win
rates, or split/execute ratios. This pass collects **VCT-like public statistics with provenance** to
corroborate the engine's existing priors and to seed the values it is missing. **Nothing here is a
judgement baseline** — those stay in `datasets/derived/priors/` (real VCT Reference). These are candidates;
the orchestrator decides what (if anything) enters priors, and **judgement metrics are not touched**.

---

## 1. What was collected (36 values, 10 metric groups)

| Group | n | Best items | Confidence |
|---|---|---|---|
| Per-map side win rate (`side_map_patch`) | 5 | Champions 2025: Abyss atk **0.579**, Haven atk **0.577**, Lotus atk **0.510**, Sunset def **0.604**, Bind def **0.549** | high |
| Plant-site distribution (`site_plant_timing_detonation`) | 8 | per-map most-planted-site share (Ascent A 0.570, Breeze A 0.662, Haven C 0.461 …) + plant times (Pacific 52.3 s, EU 60.4 s) + flash 1.0–3.1 s | high (Riot) / low (site 2021) |
| Map pick rate (`map_pick_ban`) | 7 | Champions 2025 pool: Lotus 0.205, Abyss 0.159, Corrode 0.148 … | high |
| Pistol / eco / force (`pistol_eco_force`) | 6 | pistol→2R conversion **0.909** (Berlin); per-map pistol win (Abyss atk 0.643, Sunset def 0.682) | med |
| First kill / trade (`firstkill_trade`) | 2 | **first-blood → round win 0.714** (Berlin); nAts lurk-kill share 0.351 | med / low |
| Post-plant / retake (`plant_manadv_retake`) | 2 | best-team post-plant atk win **0.748**, best-team defuse **0.391** (Fnatic 2023) | med |
| Match-state comeback (`match_result`) | 2 | 18/32 teams 0 % after a 3-9 half; ~3 % comeback from 2-10 | high |
| Ability / ult (`ability_ult_timing`) | 2 | utility share of kills **0.044** (Berlin); flash 1.0–3.1 s | med / high |
| Clutch (`clutch_multikill_kast_adr`) | 1 | 25.6 % of clutches shift momentum (156 clutches, Berlin) | med |
| Timeout (`other`) | 1 | timeout-caller round win 0.344 (Berlin) | low |

Sources used: **Riot official VCT 2023 Data Drop** (plant times, post-plant/defuse, comebacks, flash),
**TheSpike.gg** editorial map analysis (Champions 2025 per-map side + pistol + pick rates — exact numbers),
**Upcomer** analyses crediting **rib.gg** (Masters Berlin 2021: first-blood→round-win, pistol conversion,
utility/lurk/clutch/timeout). Full provenance per item in the JSON.

## 2. Comparison with the engine's current priors / baselines

Engine reference = `datasets/derived/priors/*` + `docs/VALIDATION_BASELINES.md` (VCT Reference, international).

| Metric | Engine prior (VCT Reference) | Community value | Agreement |
|---|---|---|---|
| **Pistol → next-round conversion** | **0.879** ±0.04 → [0.839, 0.919] | 0.909 (Berlin 2021, rib.gg) | ✅ **inside interval** — independent source agrees |
| **Post-plant attack win** | 0.709 (Ascent 0.738) | 0.748 (Fnatic = *best* team) | ✅ consistent (community = team upper bound, above the mean) |
| **Defuse share of opp plants** | retake visible via defuse 0.199 of all rounds | 0.391 (Fnatic = *best* defuse) | ✅ consistent (best-team retake ceiling) |
| **Attack win, Ascent** | 0.509 overall | — (Champions 2025 gives Abyss/Haven/Lotus/Sunset/Bind, not Ascent) | n/a |
| **Side win rate, non-Ascent maps** | **not modelled** (engine runs all maps on Ascent geometry → 0.50) | Abyss atk 0.579, Haven atk 0.577, Sunset def 0.604, Bind def 0.549 | ⚠️ **big gap** (see §3) |
| **First-blood → ROUND win** | **no baseline** (VALIDATION_BASELINES §6: entry→round-win not round-linked in the source) | **0.714** (Berlin 2021) | 🆕 **fills a gap** (comparison point for the harness's report-only metric) |
| **Plant-site A/B/C distribution** | **none** (no plant coords) | per-map most-planted-site share (8 maps) | 🆕 fills a gap (low confidence, 2021) |
| **Overtime frequency** | time_expired 0.034 of rounds (not OT rate) | *wanted, but only vlr-derived* (10–12 %) → **not used** | ❌ no clean source |

## 3. Metrics that deviate most from the engine today

1. **Per-map side bias (largest).** The engine prototype runs every map on Ascent geometry, so every
   map's attacker win rate collapses to ~0.50/0.51. Champions 2025 shows real, large per-map asymmetry:
   **Sunset is defense-sided (def 0.604 → atk ~0.396)**, while **Abyss (0.579) and Haven (0.577) are
   strongly attack-sided**. This is exactly the `geometry: "own"` gap (HANDOFF **P0-4**: non-Ascent maps
   need their own side baselines). These five map/side numbers are the highest-value fill here.
2. **First-blood → round win ≈ 0.71.** The engine has opening-*duel* win rate (who wins the first fight,
   0.437–0.457) but no entry→round-win link. 0.714 says ~71 % of rounds go to the first-blood team — a
   strong snowball the harness currently reports as "no baseline". Use it as a sanity target, not a tuning knob.
3. **Deep-deficit comeback ≈ 0 (official).** 18/32 teams never won after a 3-9 half; ~3 % from 2-10;
   0-26 from 1-11. The round-value/save engine (README §20, §26.3) should reproduce a snowball this steep;
   a sim that lets 2-10 teams win >5 % is under-modelling momentum.

## 4. Candidate values for `priors/` (orchestrator decides — I did not modify priors)

| Candidate | Value(s) | Target | Confidence | Note |
|---|---|---|---|---|
| **Per-map side baselines** | Abyss atk 0.579, Haven atk 0.577, Lotus atk 0.510, Sunset def 0.604, Bind def 0.549 | extend `side_map_baselines.json` beyond Ascent | high (exact, Champions 2025, international) | per-event sample (14–18 maps each); pair with VCT Reference per-map cuts before promoting |
| **Plant-site distribution** | per-map most-planted-site share (8 maps) | new prior for `plantTactics` site selection | low (2021, loose definition, pre-rework maps) | shape only; re-collect from a current source before trusting magnitudes |
| **First-blood → round win** | 0.714 | report-metric comparison vs `combat_opening_duel.json` | med (one event, no denominator) | do **not** retune combat constants to it (VALIDATION_BASELINES §6 warning) |
| **Pistol conversion** | 0.909 | **confirms** `pistol_conversion.json` 0.879 | med | no change needed — corroboration only |
| **Utility share of kills** | 0.044 | reference for `enableAbilities` calibration (abilities 4/8) | med | 2021 meta |

**Do not change judgement metrics** (the 15 validation cells). Everything above is corroboration or a
report-only comparison; the Champions-2025 per-map side numbers are the only set worth a real priors change,
and only after cross-checking against a VCT Reference per-map slice.

## 5. For session H (`claude/pv3-stats`: box-score + KAST/ADR/clutch distributions)

Flagged `useful_for_session_H: true` in the JSON (3 items): **clutch momentum shift 0.256** (156 clutches,
Berlin), **first-blood → round win 0.714**, **utility share of kills 0.044**. No public **KAST/ADR
distribution** numbers were found in clean sources this pass (the detailed per-player distributions live
behind vlr-derived datasets or paid feeds). H's KAST/ADR extension will likely have to come from the VCT
Reference `player_map` block, not community data — flagging that so H doesn't wait on this pass for it.

## 6. Blocked / unusable sources (recorded, not bypassed)

| Source | Host | Status | Why not used |
|---|---|---|---|
| Reddit (r/ValorantCompetitive, r/VALORANT, old.reddit JSON) | reddit.com | **403** | Reddit blocks unauthenticated JSON from this cloud IP (full block page). No browser spoof (task rule). |
| Pushshift | api.pushshift.io | 403 | Access gated to approved Reddit mods. |
| Liquipedia API | liquipedia.net | **429** | Cloudflare anti-scraper; terms forbid scraper/bot access without an approved arrangement. |
| MetaSRC (ranked aggregate) | metasrc.com | 403 | robots.txt Disallows all AI crawlers + `ai-train=no`; Cloudflare 403. Respected. |
| rib.gg (direct) | rib.gg | 429 | Used **second-hand** via Upcomer's published, rib.gg-credited articles. |
| **Kaggle `ryanluong1/valorant-champion-tour`** (round methods, maps_stats, overtime) | kaggle.com | **vlr-derived** | Its scraper `RyanLuong1/vct-web-scraping` is "Web scraping VCT … data **from vlr.gg**" → forbidden. The m1ke-dev analysis builds on it → also excluded. |
| vlr.gg + vlr-derived datasets | vlr.gg | policy | Excluded by task policy (ToS). Upcomer Part 2's agent-pick table is vlr-sourced → those figures not taken. |
| IEEE DataPort — VCT 2024 Pacific/EMEA round data (1301 rounds, economy) | ieee-dataport.org | login | Strong **round-level** lead; download requires login. Candidate for a future authorized pull. |

**Key finding for the orchestrator:** the richest *free* VCT **round-level** data (round win methods,
per-round economy) is overwhelmingly **vlr-scraped** and therefore off-limits. Clean round/positional data
is gated behind **IEEE DataPort** (login) or **GRID Open Access** (`docs/research/GRID_ACCESS.md` — user
decision, free non-commercial, but positions unconfirmed). The project's clean round **results** already
live in `vct.duckdb` (VCT Reference); what is genuinely missing (positions/events) has **no free clean
source** and needs the `.vrf`/GRID path.

## 7. Ranked-tier note

Per the user's directive, any ranked-tier value would be restricted to **Immortal+**. None is included this
pass: the one structured ranked aggregator reachable in theory (MetaSRC) is robots-disallowed for AI
clients and Cloudflare-blocked, so all 36 values are **pro/VCT**-scope, not ranked.

## 8. Next (for whoever the orchestrator assigns)

- Mine the **Riot VCT 2023 Data Drop chart images** (plant/pistol/weapon/ult rankings are in images, not
  text) — needs OCR/vision, out of scope for this HTTP pass.
- Check for a **newer official Riot/GRID data drop** (2024/2025) with text stats.
- If authorized: pull the **IEEE DataPort 2024 round dataset** (clean, economy-tagged, 1301 rounds).
- A **current-patch** re-collection of per-map side baselines + plant-site split from TheSpike's live stats
  pages (exact numbers, not the editorial articles) to replace the 2021 site figures.
