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

### 3.1 Diagnosis — the post-plant overshoot is a retake-distance problem

The seven problem maps win 0.78–0.90 of rounds after the plant because, when the spike goes down, the nearest living defender is far away and the retake is either not fought (it saves) or arrives too late. I measured the structural driver directly from the derived tactics: the time for the **nearest defender that is not already standing on the planted site** to reach that site (the retake a surviving off-site defender has to run). Defenders start on the sites (2-2-1 with a mid/central defender where one is derived), so this is the retake clock after the site's own defenders die.

| Map | mid/central defender | worst-site retake run | §7.6 in-range? |
|---|---|---|---|
| Ascent (baseline) | mid-courtyard | **9.6 s** | baseline |
| Abyss | mid-top | 10.3 s | nearly |
| Breeze | mid-top | 10.4 s | yes |
| Icebox | mid-pallet (A-biased 5.1 / 10.2) | 10.2 s | no |
| Haven | — (3-site, no mid defender) | 10.1 s | no |
| Lotus | — (3-site, no mid defender) | 10.6 s | no |
| Sunset | mid-courtyard | 12.0 s | no |
| Split | mid-top (A-biased 10.0 / 15.2) | 15.2 s | no |
| Fracture | — (no mid zone) | 15.1 s | no |
| Bind | — (no mid zone) | 15.7 s | no |
| Pearl | — (no mid zone) | **18.9 s** | no |

Reading: **every map whose derived setup has no balanced central defender (bind, fracture, pearl: no mid zone; haven, lotus: three sites) rotates 15–19 s to the far site** — 1.5–2× Ascent. Split and Sunset have a mid defender but its zone is biased to one site, so the far site is still a long retake. Ascent, Abyss, Breeze, Icebox sit at ~10 s and are the ones at or near the target band. The "nearest defender 57–81 m at plant vs Ascent 27 m" clue in HANDOFF §5 P1-6 is the same fact in metres.

### 3.2 Per-map measurement (sim-batch --geometry own, 60 matches, seeds 1..60)

<!-- FILLED AFTER BASELINE LOOP -->

### 3.3 Fix — central-rotator defender placement (map data, authored `defenderStarts`)

<!-- FILLED AFTER EXPERIMENT -->

## 4. `geometry: "own"` as default — recommendation

<!-- decided at integration -->

## 5. Remaining work

- <!-- TBD -->
