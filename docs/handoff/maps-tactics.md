# Handoff — per-map tactics (branch `claude/nav-engine`)

Written 2026-11-23 at wrap-up. Branch is on top of main `bcc3458`, **not pushed, not merged**.
The task is **not finished**: the code for goals 1–3 exists, the validation, tests and docs of goals 5–8 do not.

## Per-map status (updated as each map lands)

Definition of done per map: (1) roadmap with no unreachable zone, (2) sight table, (3) derived tactics pass
`spatial-engine/test/tactics.test.ts`, (4) `<map>.objects.json` (drops with fall height, ropes / ziplines /
teleporters as typed links, doors, breakables), (5) own-geometry real-roster batch in range (attack 0.42–0.58,
elimination ~0.60–0.75, detonation ≤ ~0.15). Last update: 2026-11-23 evening — all batches below are real rosters, seeds 1..60 (Ascent 1..160), attack / elimination / detonation / defuse. Items 1–4 hold on every map; item 5 holds on Breeze only (Abyss within 0.013), so no map is marked done and `geometry: "own"` stays opt-in.

| Map | Roadmap gaps | Sight table | Tactics tests | objects.json | Real-roster batch (own geometry) | Done |
|---|---|---|---|---|---|---|
| Ascent | none | yes | pass | `3da5f8d` | 160, default geometry: 0.455 / 0.728 / 0.085 / 0.136, 6/8 — gate held (≥6/8, attack 0.455 ± 0.02) | no |
| Abyss | none | yes | pass | `99427ea` | 60: 0.507 / 0.618 / 0.163 / 0.155, 7/9 — nearly (detonation 0.013 over) | no |
| Bind | none | yes | pass | `bde66f4` | 60 on the rebuilt roadmap: 0.501 / 0.572 / 0.237 / 0.104, time 0.088, 3/8 — **no**. Before the rebuild (2 nodes fewer, links between zone anchors): 0.502 / 0.751 / 0.135 / 0.083 — the result is not robust to a roadmap resample | no |
| Breeze | none | yes | pass | `202d8b5` | 60: 0.522 / 0.764 / 0.085 / 0.122, 6/8 — in range (elimination 0.014 over) | no |
| Fracture | none | yes | pass | `a52a61b` | 60: 0.482 / 0.540 / 0.279 / 0.155, 6/8 — no, detonation high | no |
| Haven | none | yes | pass | `fe09571` | 60: 0.489 / 0.416 / 0.236 / 0.288, 4/8 — no, elimination low, detonation and defuse high | no |
| Icebox | none | yes | pass | `a42c3a7` | 60: 0.454 / 0.578 / 0.218 / 0.181, 4/8 — no, detonation high | no |
| Lotus | none | yes | pass | `0f7041c` | 60: 0.493 / 0.475 / 0.204 / 0.255, 4/8 — no, elimination low, detonation high | no |
| Pearl | none | yes | pass | `fe09571` | 60: 0.421 / 0.585 / 0.212 / 0.170, 3/8 — no, detonation high; attack at the lower edge | no |
| Split | none | yes | pass | `fecde40` | 60: 0.496 / 0.594 / 0.209 / 0.172, 3/8 — no, detonation high | no |
| Sunset | none | yes | pass | `fe09571` | 60: 0.519 / 0.582 / 0.202 / 0.174, 4/8 — no, detonation high | no |

### Map data for the pro-technique backlog (`docs/research/PRO_TECHNIQUES_BACKLOG.md`, MAP-1…MAP-6)

What exists, for the engine session. All of it is the same for the eleven maps unless stated.

| Item | Data | State | Where |
|---|---|---|---|
| MAP-1 | Named holding spots per site (standard + off-angle per entry): position, entries seen, exposure, cover grade | **done, all 11 maps** (`fc74531`), derived; ≥ 6 per site on Ascent. `cover` is a ranking of measured exposure, not a body-cover measurement | `loadMapTactics(id).sites[i].holdSpots` (`spatial-engine/src/spots.ts`) |
| MAP-5 | Plant spots default / safe / open per site, as points on the plantable area | **done, all 11 maps** (`fc74531`), derived | `…sites[i].plantSpots` |
| MAP-3 | Drop edges with fall height | in progress (with `<map>.objects.json`) | `datasets/spatial/<map>/<map>.objects.json` → `drops` |
| MAP-3 | Jump spots (airtime, what they see) | **not available** — the roadmap has no jump model; Abyss's jump gaps are the open question of its two roadmap gaps | — |
| MAP-4 / MS-09 | Ropes, ziplines, teleporters as typed links with entry/exit points and sound source positions | in progress; sound radius left `null`, `soundVerified: false` (no measured value) | `<map>.objects.json` → `traversals`; `<map>.nav.json` → `links` |
| EC-05 | Ult orb positions | in progress — only if the scene has identifiable orb objects; otherwise listed under `notLocated` | `<map>.objects.json` → `ultOrbs` |
| DF-05 | Off-angle spots | covered by MAP-1 (`kind: "off-angle"`) | as MAP-1 |
| MAP-2 | Lineup throw points | **not available** — needs own measurement in custom games; nothing derivable from the tables | — |
| MAP-6 / UT-03 | One-way smoke spots | **not available** — smokes are zone-level in the engine; candidates could be derived from the sight table once smokes are positional | — |

Every batch before 2026-11-23 in this note was a league-average mirror (`sim-batch --mirror`); the numbers
further down are that condition and are kept only as the "before". Real rosters are the default now.

Open cross-session items: (a) a duel winner is free again on the next 100 ms tick whatever the duel's
`timeToKillMs` (`round-simulator/src/simulator.ts`, the `busy` set in the combat loop) — reported to the
engine-truth session, which owns that loop; (b) ropes are not yet links, which is why Icebox A Nest and Split
Mid Vent are unreachable.

## Commits, oldest first

| Commit | What | Verified |
|---|---|---|
| `557b672` | Derived per-map tactics + third site in the strategy vocabulary | Ascent matches byte-identical to main (match signature equal) |
| `20779a1` | A holder stands where it sees what it watches | Ascent 160 matches: 8/8 judged, attack 0.489 |
| `27bac33` | Retake: one defender to the spike, the others to covered spots that see it | Ascent 160 matches: 8/8 judged, attack 0.498 |
| `b0ed5ed`, `11ec870` | `wip` — Haven B Site / Pearl source-data fix (saved by the integrating session) | See "Half-done" — table checks pass, no match batch run |
| `60ef687` | Mover: a re-plan inside a timed link keeps the link (Bind teleporter bug) + this note | Ascent signature unchanged; Bind floor test passes |

## Done and verified

**Derived tactics** — `packages/spatial-engine/src/tactics.ts` (`deriveMapTactics`), loaded by
`match-runner/src/setup.ts` (`loadTactics`) and passed to the team policy (`TeamPolicyOptions.tactics`).
Per map, from the zone graph and roadmap travel times only:

- site = plantable zone of type `site`; its letter from the zone's data
- main entry = the zone before the site on the attack's fastest route; entries = the site's neighbours the attack
  reaches before the site
- aim = main entry; smokes = main entry + up to two defender-side zones that see the site
- mid anchor = among `mid` zones the defence reaches first, the one with the smallest attack-minus-defence
  arrival gap (none if the defence is more than 4 s late); two-site maps only
- defender starts = one per site, then the mid anchor, then extra defenders to the sites the attack reaches soonest
- hand-authored overrides only in `datasets/spatial/<map>/<map>.tactics.json`; only Ascent has one (mid aim,
  smoke lists), which makes the derived Ascent data equal the old built-in tables

**Third site** — `cExecute` / `stackC` in `shared-types`, `team-engine/src/igl.ts` (`selectStrategy`,
`reconsider` take a `sites` list) and `policy.ts`. Two-site code path unchanged. Haven and Lotus derive three sites.

**Sight-aware spots** — `SpotIntent` kind `see` (`round-simulator/src/mover.ts`), chosen in
`simulator.ts` (`watchIntent`, `spikeRunnerOf`): defender pre-plant sees its aim zone; attacker post-plant sees
the spike; on a retake the nearest defender goes to the spike, the others to the least-exposed spot that sees it.

**Ascent, 160 matches, after `27bac33`** (default geometry): 8/8 judged. Attack 0.498, elimination 0.713,
detonation 0.093, defuse 0.153, time 0.041, opening duel 0.427, pistol 0.541, full-v-full 0.467.
The mover fix in the last commit leaves Ascent's match signature unchanged
(`ALL 97c9a702…4fcbbc` before and after), so these numbers still hold.

**Mover bug found at wrap-up and fixed** — a player given a new goal while held in a Bind teleporter had the
rest of the teleport turned into a straight walk to the exit (seen: 2.3 km and 13.2 km lines at running speed,
838 uu off the floor). `match-runner/test/geometry.test.ts` (Bind floor) failed on `27bac33`; it surfaced once
defenders started from Bind's own positions. Fix in `mover.ts` `plan()`: the link in progress is kept with its
elapsed time. After it: 0 off-floor samples, `geometry.test.ts` + `movement-floor.test.ts` 16/16.

**Suites on the final tree** — see the last section; filled in from the run at wrap-up.

## Half-done — exactly where it stops

1. **Haven B Site / Pearl data fix (`b0ed5ed`, `11ec870`)** — done by a subagent that hit the usage limit while
   comparing regenerated navgraphs with the committed ones.
   - What it did: new `zoneAnchors` key in `<map>.authoring.json` (floor point a zone stands on when its callout
     is not on that floor), read by `tools/map-mesh/pipeline/measure_map.py` and `tools/map-processor/build_map.py`.
     Haven: `b-site` (callout sits on the roof of the site's central structure). Pearl: `b-club`, `mid-plaza`,
     `b-link`, `a-link`, `defender-water` (callouts inside building footprints / stacked on Mid Shops).
   - Checked by me after the limit reset: pipeline logs end with Haven 420/420 and Pearl 650/650 zone pairs
     reachable, 0 ray-bad; spatial-engine suite 278 pass with Haven/Pearl removed from `ROADMAP_GAPS` and Pearl
     from `SIGHTLINE_DISAGREEMENTS`; both maps load their sight table; a match on each runs to the end;
     derived Haven tactics now give B Site a travel time (attack 11.7 s, defence 9.7 s). No mesh, grid, `.blend`
     or `.glb` in git; `mesh.npz` deleted for both maps.
   - **Not checked:** the navgraph diff the subagent was reading (edge times and sightlines changed for both
     maps — nobody reviewed whether every change is intended); Pearl's anchors carry the provenance
     "manual-approx (that this named floor is the callout's zone)"; no match batch on either map; desktop copies
     under `apps/desktop/src/data/sim/` not refreshed for Haven/Pearl; `docs/research/MAPS_DATA.md` not updated.
2. **Tests for the derived tactics** — none written. A scratch check (not in the repo) showed, on all eleven
   maps, every site has spots that see its main entry and every plant-area point is seen from another site
   point; all entries are seen except Ascent B (2 of 3).
3. **Per-map validation** — only a 40-match run on six maps after `27bac33`, before the Haven/Pearl fix and the
   teleporter fix. Breeze, Fracture, Haven, Pearl not run. Bind's number predates the teleporter fix.
4. **Docs** — `NAVIGATION_ENGINE.md` / `MAP_TACTICS.md` / `STAT_OUTCOME_MATRIX.md` not updated for any of this.

## Known problems and measured causes

Own geometry, attack win / elimination / detonation / defuse. "Before" = `3aadf2d`, 60 matches (attack only
recorded for most maps); "after" = `27bac33`, 40 matches. Targets: attack 0.42–0.58, elimination 0.60–0.75,
detonation ≤ ~0.15.

| Map | Before (attack) | After | Target met |
|---|---|---|---|
| Abyss | 0.544 | 0.483 / 0.533 / 0.211 / 0.218 | attack only |
| Bind | 0.542 | 0.542 / 0.714 / 0.167 / 0.084 | nearly (detonation slightly high) |
| Icebox | 0.492 | 0.466 / 0.595 / 0.211 / 0.164 | attack only |
| Lotus | 0.570 | 0.584 / 0.548 / 0.182 / 0.217 | no (attack just over, elimination low) |
| Split | 0.526 (elim 0.364, det 0.342, defuse 0.281) | 0.547 / 0.528 / 0.264 / 0.176 | attack only |
| Sunset | 0.575 | 0.488 / 0.526 / 0.202 / 0.215 | attack only |
| Breeze, Fracture, Haven, Pearl | 0.513, 0.468, 0.390, 0.531 | not run | unknown |

- **Detonations ~20 %, eliminations ~0.53–0.60 on most maps.** Traced on Split: right after the plant the
  defenders waiting in A Tower step out one after another; one spike-watching attacker kills two within 0.3 s,
  the last defender saves. Cause is retake execution in the policy plus duels resolved one at a time — not map
  data. Not tuned (constraint: no retuning of duel odds, speeds or global constants).
- **Defuses with attackers alive** dropped with the spike-watch rule: Split 60 % → 14 %, Sunset 35 % → 22 %,
  Bind 29 % → 13 %, Icebox 26 % → 14 %, Lotus 0 %.
- **Third site is half-wired outside the round:** the opponent model / scouting only knows sites A and B (C has
  no cross-round tendency) and fakes are A↔B only.
- **`geometry: "own"` is still opt-in.** Not proposed as default: no map set is fully in range.
- `round-simulator/test/perf.test.ts` ran 115 s (limit 60 s) once while 14+ other processes loaded the machine.
- `apps/desktop/node_modules` in this worktree is an untracked symlink to another worktree's install.

## Next steps, in order

1. Review `b0ed5ed` navgraph diffs for Haven and Pearl (edge times, sightlines), refresh the desktop data copies
   if those maps are used there, then squash the two `wip` commits into a normal one.
2. Write the tests: derived Ascent tactics equal the old tables; per map every site has defender spots that see
   its entries and every post-plant spot sees the plant area; Haven C reachable and chosen in some rounds;
   `selectStrategy` / `reconsider` with three sites; a regression test for the teleporter re-plan.
3. Validate, one batch at a time through `/Users/yi-rang/ProjectV-assets/tools/heavy-run.sh`: Ascent 160
   (default geometry), then each of the ten maps 60–80 matches with `--geometry own` and its own `--out/--report`.
4. Work the retake cause (defenders leaving cover one by one): make the retake step out together, or let the
   spike-watcher's follow-up duels be simultaneous. Re-measure Split first — it is the clearest case.
5. Teach the opponent model site C; allow fakes involving C.
6. Docs: `docs/MAP_TACTICS.md` with the formulas above and the full before/after table; `STAT_OUTCOME_MATRIX.md`
   entry; `MAPS_DATA.md` for `zoneAnchors`.
7. Full suites + desktop typecheck/build/unit/engine/e2e/e2e:series (each e2e alone, through `heavy-run.sh`,
   with `PLAYWRIGHT_REQUIRE_BASE`; restore regenerated `apps/desktop/docs/*.png`).
8. Only if every map lands in range: propose `geometry: "own"` as the default, on its own commit.

## Suites at wrap-up

round-simulator 121 pass, spatial-engine 278 pass, match-runner geometry + movement-floor 16 pass. The other suites were interrupted and are re-run after the merge of the integration branch.
