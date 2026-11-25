# Handoff — map own-geometry & ult orbs (session D, branch `claude/pv2-maps`)

Written 2026-11-25. Covers HANDOFF P1-6 (map own-geometry) and P1-8 (ult orbs).
Not merged, not a PR. Gate reference and all runs are `sim-batch` with `PYTHON` = a venv with jsonschema.

## 0. Gate reference (Ascent, default geometry, seeds 1–160)

| Condition | core 8 | total | elim / det / defuse / time | attack | opening | pistol | full-v-full | signature |
|---|---|---|---|---|---|---|---|---|
| main HEAD (orbs on) | 8/8 | 13/15 | 0.681 / 0.078 / 0.185 / 0.056 | 0.508 | 0.449 | 0.469 | 0.486 | `38bf4c55…` |
| this branch (orbs off, new default) | 8/8 | 13/15 | 0.681 / 0.078 / 0.185 / 0.056 | 0.508 | 0.449 | 0.469 | 0.486 | `59f054d8…` |

The two total-set fails are the economy cells full/eco (0.905, n=25 small-sample, flagged don't-tune in VALIDATION_BASELINES §1) and eco/full (0.099) — pre-existing on main. The orb-flag change leaves every judged metric identical to three decimals; the signature differs only because orbPickup events are gone and a few buys shuffle (they wash out in aggregate). **Default gate holds.**

## 1. Ult orbs (P1-8) — done

- Orb positions wired for the seven maps that had none (abyss, breeze, fracture, icebox, lotus, pearl, sunset), from `docs/research/ULT_ORBS.md` §1. Each orb: the zone id (VALORANT wiki `Map:` marker + guide callouts) placed at that zone's roadmap anchor, `verified:false`, with a `source` URL and `confidence` (H/M/L). The four already-filled maps (ascent, bind, haven, split) are unchanged.
- Counts: 2 per map except **Fracture = 4** and **Lotus = 2** (the pre-8.0 B Main orb stays removed). Low-confidence rows: **Fracture SW** = B Main (wiki), alt B Tree recorded in the provenance; **Bind B** kept at B Long (main's value; wiki marker suggests B Garden). The wiki grid markers were left unconverted — the 0–1024 grid orientation does not reproduce Ascent's two known orbs through `coordinate-system.json`, so positions stay zone-level (anchor) like the existing four.
- **Engine path behind a flag, default OFF.** `MatchConfig.ultOrbs` (sim-batch `--ult-orbs`) gates orb pickup; default false. Guns are still picked up during the round either way. Rationale: a pickup credits one ultimate point, which feeds the buy evaluation (`ultHold`, `ready * ultValue`) even with abilities off, so it moves outcomes; held behind the flag until positions are confirmed. Ascent default gate unchanged (§0).
- Tests: `economy.test.ts` asserts default-off / opt-in and that guns still drop; `objects.test.ts` checks every orb is inside the roadmap bounds. Full match-runner (136), round-simulator (165), spatial-engine (442) suites pass.

## 2. Haven / Pearl nav-engine fixes (task item 3) — already on main

The "not validated" Haven B reachability and Pearl B Club zoneAnchors fixes (`b0ed5ed`, `11ec870` on `origin/claude/nav-engine`) are **already ancestors of main** — current `haven.authoring.json` / `pearl.authoring.json` carry the `zoneAnchors`, and main added the ult-orb blocks on top. nav-engine is strictly behind main for these files; nothing to port. They are validated here as part of the own-geometry runs (§3). Still outstanding from the nav-engine note: desktop data copies under `apps/desktop/src/data/sim/` were never refreshed for Haven/Pearl (only Ascent is drawn, so this does not affect the sim), and `docs/research/MAPS_DATA.md` was not updated for `zoneAnchors`.

## 3. Map own-geometry (P1-6)

### 3.1 Per-map measurement (sim-batch --geometry own, 60 matches, seeds 1..60)

Ascent is the default-geometry gate row (seeds 1..160); the rest are each map on its own geometry. `retake s` = time for the nearest defender **not** standing on a site to reach that site (worst site), from the derived `defenderStarts` — the clock a surviving off-site defender runs after the site's own defenders die. Targets (HANDOFF/§7.6 convention): attack 0.42–0.58, elimination ~0.60–0.75, detonation ≤ ~0.15.

| Map | attack | elim | **det** | defuse | time | opening | plant | postPlantAtk | retake s | mid/central def |
|---|---|---|---|---|---|---|---|---|---|---|
| **Ascent** (default geom) | 0.508 | 0.681 | **0.078** | 0.185 | 0.056 | 0.449 | 0.636 | 0.708 | 9.6 | mid-courtyard |
| Abyss | 0.653 | 0.575 | 0.253 | 0.137 | 0.034 | 0.508 | 0.691 | 0.801 | 10.3 | mid-top |
| Bind | 0.501 | 0.619 | 0.257 | 0.051 | 0.073 | 0.278 | 0.487 | **0.896** | 15.7 | none (no mid) |
| Breeze | 0.573 | 0.702 | 0.156 | 0.125 | 0.017 | 0.502 | 0.688 | 0.818 | 10.4 | mid-top |
| Fracture | 0.640 | 0.518 | **0.354** | 0.105 | 0.022 | 0.454 | 0.693 | 0.848 | 15.1 | none (no mid) |
| Haven | 0.670 | 0.451 | 0.318 | 0.207 | 0.024 | 0.467 | **0.852** | 0.757 | 10.1 | none (3-site) |
| Icebox | 0.501 | 0.501 | 0.239 | 0.240 | 0.020 | 0.512 | 0.700 | 0.657 | 10.2 | mid-pallet |
| Lotus | 0.671 | 0.463 | 0.309 | 0.198 | 0.030 | 0.419 | **0.853** | 0.768 | 10.6 | none (3-site) |
| Pearl | 0.525 | 0.582 | 0.200 | 0.186 | 0.032 | 0.384 | 0.674 | 0.724 | 18.9 | none (no mid) |
| Split | 0.669 | 0.480 | **0.396** | 0.104 | 0.020 | 0.411 | 0.735 | 0.858 | 15.2 | mid-top (A-biased) |
| Sunset | 0.456 | 0.603 | 0.199 | 0.097 | 0.100 | 0.345 | 0.517 | 0.812 | 12.0 | mid-courtyard |

### 3.2 Diagnosis

The HANDOFF P1-6 clue ("7 maps at 0.78–0.90 post-plant, nearest defender 57–81 m") predates the derived per-map tactics now on main; the current picture is both milder and more heterogeneous:

- **The one universal miss is detonation: 0.16–0.40 on every non-Ascent map vs Ascent's 0.078.** Too many planted rounds end in a detonation — the defense does not win the planted round back. Attack win rate itself is in band on six maps; the round-end *mix* is what is wrong (more detonations, fewer eliminations).
- **Retake distance is a real but partial driver.** The two maps with no mid zone *and* a long rotation — Bind (15.7 s → postPlant 0.896, defuse 0.051) and Fracture (15.1 s → 0.848) — have the highest post-plant attack win: a surviving defender is too far to retake, so it saves and the spike runs down. But it is not the whole story: Pearl has the longest rotation (18.9 s) yet a near-normal postPlant 0.724, and Breeze rotates only 10.4 s yet sits at 0.818. There is a **~0.80 post-plant floor across maps regardless of distance** (vs Ascent 0.708), which is the retake *execution* being tuned to Ascent's geometry and positions (duels resolved one at a time, retake step-out), **not** map data — that belongs to the Ascent-behaviour-logic session (C) and is flagged to the orchestrator.
- **A second, separate miss is plant rate on the three-site maps** — Haven 0.852, Lotus 0.853 (vs Ascent 0.636): the defense loses the pre-plant fight too often because five defenders cover three sites (2-2-1 with no mid rotator), so each site is thin. Their post-plant is only moderate (0.757 / 0.768); the detonations come from the sheer number of plants.
- Attack-sided maps (attack > 0.58): Abyss, Fracture, Haven, Lotus, Split.

### 3.3 Fix — central-rotator defender placement (map data: authored `defenderStarts`)

Within this session's scope (map data / per-map placement, not the Ascent behaviour logic), the tractable lever is the no-mid maps' retake distance. Bind and Fracture derive a 3-2 / 2-3 split across the two sites with **no central defender**, so the nearest off-site defender is 15–16 s away. I authored a `defenderStarts` override that moves one defender to the most central reachable zone (Bind → `b-teleporter`, the fast A↔B teleport link, ≤ 9 s to either site; Fracture → `b-link`, ≤ 9.8 s), i.e. a 2-2-1 with a rotator, mirroring what Ascent/Breeze/etc. get for free from a derived mid anchor. Pearl is left alone (no mid, but its post-plant is already normal). The three-site maps and the mid-but-biased maps (Split, Sunset) are **not** changed here — their miss is pre-plant plant-rate or retake logic, not a missing rotator.

| Map | change | before: postPlant / det / elim / attack | after: postPlant / det / elim / attack | kept? |
|---|---|---|---|---|
| Bind | +rotator `b-teleporter` | 0.896 / 0.257 / 0.619 / 0.501 | 0.845 / **0.174** / 0.711 / 0.419 | **yes** |
| Fracture | +rotator `b-link` | 0.848 / 0.354 / 0.518 / 0.640 | 0.865 / 0.371 / 0.480 / 0.625 | no (reverted) |

**Verdict.** The rotator works on **Bind**: detonation 0.257 → 0.174 (toward the ≤0.15 target), elimination 0.619 → 0.711 (into band), post-plant 0.896 → 0.845, and plant rate 0.487 → 0.389 — the central defender both contests entries and retakes faster. The cost is attack 0.501 → 0.419 (at the band edge; the `b-teleporter` choke makes the defense strong, opening-duel 0.278 → 0.160), so a milder central zone could rebalance if 0.419 is judged too low — but detonation, the headline miss, clearly improves, so the override is **kept**. On **Fracture** the same idea did nothing (detonation 0.354 → 0.371): Fracture's two attacker spawns make it a pincer-defense problem, not a retake-distance one, so the `b-link` rotator was **reverted**. Net: one validated map-data fix (Bind), and confirmation that the rest of the overshoot is not a placement problem.

## 4. `geometry: "own"` as default — recommendation

**Not yet.** Only Breeze was ever in range and even it detonates at 0.156 on this measurement; every other map misses detonation (0.20–0.40) and several miss attack-side balance. Own geometry should stay opt-in until the retake-execution logic is made map-aware (session C) and the three-site pre-plant defense is strengthened. Keeping it opt-in costs nothing — the shipped product draws and plays Ascent only. Decision is the orchestrator's at integration.

## 5. Remaining work

- **Retake execution is Ascent-tuned (LOGIC, session C / orchestrator):** a ~0.80 post-plant floor on every non-Ascent map regardless of retake distance. Needs the retake to be map-aware (simultaneous step-out / duel resolution, post-plant positions chosen by what sees the spike). This is the dominant lever and is out of this session's map-data scope.
- **Three-site pre-plant defense (Haven, Lotus):** plant rate ~0.85. Five defenders over three sites leaves each thin; a derived rotator for 3-site maps (or authored 2-1-1-1 with a rotator) is a placement idea worth testing, but 3-site retake logic is also Ascent-tuned.
- **Per-map robustness:** 60 matches on one roadmap is weak evidence (HANDOFF §7.6 caveat); re-measure at 160 before trusting a third decimal.
- **Haven/Pearl:** desktop data copies (`apps/desktop/src/data/sim/`) not refreshed and `MAPS_DATA.md` not updated for `zoneAnchors` (carried over from the nav-engine note; does not affect the sim).
