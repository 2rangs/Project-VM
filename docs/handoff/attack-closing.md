# Hand-off — attack close-out (pre-plant man-advantage, spike drop)

Branch `claude/pv2-closing`. Scope: HANDOFF §5 P0-2 "공격 마무리" (attack close-out) and the eco
cells it feeds. Last updated 2026-11-25 (on main `889ebef`, 27th merge, `ecoSidearms` default on).

## TL;DR

A carrier **cut down mid-plant** never dropped the spike, so a man-advantage attack whose planter was
traded **froze on the site and ran the clock out**. One correctness fix in the round-simulator spike
model removes the freeze; the existing execute → recover → re-plant/hunt policy then closes the round
out on its own (no constant added, behaviour emerges). Default **on** — the original 8 judged metrics
do not regress on either seed range.

- Attack-up-&-no-plant time-outs: **78 → 0** (seeds 1–160), **82 → 0** (161–320).
- `full` vs `eco` cell: **0.905 → 0.953** (1–160, was failing), **0.934 → 0.988** (161–320).
- Trade-off: it exposes that the sim's **eco *defence* is too weak** once it can no longer win on the
  attack's time-out — `semi` vs `eco` overshoots (0.958 → 0.991 / 0.931 → 0.981). Not one of the 8;
  see "Trade-offs". `eco` vs `full` stays a miss but is a don't-tune small-sample cell.

## 1. Cause (measured, not assumed)

Reproduced on the main baseline bundle (`sim-batch`, real rosters, Ascent). Counting rounds with
`buyTiers.defense == "eco"`, `reason == "timeExpired"`, alive from kill events (economy.md's recipe):

- `full` vs `eco`: 5.7% (1–160) / 6.0% (161–320) of rounds end by time — **8 of 9 / 8 of 10 with the
  attack man-up and no plant**, the modal state **4 alive vs 1 defender**.
- Across *all* rounds, 78 (1–160) / 82 (161–320) end with the attack man-up and no plant.

Traced one such round (match 31 round 5, T1 vs GIANTX) decision-by-decision. The attack executes A,
kills down to **4v1 at 25.4 s**, the carrier `atk1` is traded **in the same tick it was planting** —
then nothing: all four survivors `hold[plan:go-hold]` on the site, clock 100 s → 0, defence wins.

Root cause in `packages/round-simulator/src/simulator.ts`:

- The spike-drop in both death handlers (duel `resolveEngagements`, molly) only cleared the carrier on
  `spike.phase === "carried"`. A carrier killed while **planting** (phase `"planting"`) kept
  `carrierId` pointing at the dead player; `stepSpike` then reset the phase to `"carried"` but left the
  stale `carrierId`, and `zoneId`/`position` null.
- The ground-pickup check (`phase === "carried" && !carrierId && zoneId`) can never fire with a
  non-null `carrierId` and a null zone, so the spike is **orphaned on a dead player**.
- `team-engine` `commitSpikeCarrier` sees a truthy `holderId`, looks up the carrier by `id && alive`,
  finds nobody (dead), and returns early — no recovery order, no plant. The survivors keep their drawn
  `hold`. The round is unwinnable by the attack even at 4v1.

## 2. Change

`packages/round-simulator/src/simulator.ts` — both carrier-death paths drop the spike on phase
`"carried"` **or** `"planting"` (the planter drops it where it falls, as in the live game):

```
- if (state.spike.carrierId === loser.id && state.spike.phase === "carried") {
+ if (state.spike.carrierId === loser.id && (state.spike.phase === "carried" || state.spike.phase === "planting")) {
```

(same one-line change in the molly path). Nothing else — no constant, no new flag. After the drop the
spike is a ground spike (`carrierId` null, `zoneId`/`position` set); the pickup step recovers it the
next tick and the existing execute/recover policy re-plants or hunts the last defender. The man-up
close-out ("clear and plant, or hunt the survivor") is the *emergent* result, which is why no policy
behaviour or tuning was added.

Regression test: `packages/round-simulator/test/spike-pickup.test.ts` — "a carrier cut down mid-plant
drops the spike": the planter is traded while `phase === "planting"` and a teammate recovers it
(`spikePickup`). Fails on the old code (no pickup), passes now.

## 3. Gate — both seed ranges vs main `889ebef` (real rosters, Ascent, 160 matches each)

Reports: `docs/research/SIM_ATTACK_CLOSEOUT_2026-11-25_{1-160,161-320}.json`.
Default flip rule (HANDOFF): change the default only if the **original 8** do not get worse on **both**
ranges. They do not — so this is default on.

### Original 8 (the gate)

| metric | main 1–160 | **fix 1–160** | main 161–320 | **fix 161–320** |
|---|---|---|---|---|
| elimination (0.714 ±.04) | 0.681 ✅ | 0.703 ✅ | 0.682 ✅ | 0.710 ✅ |
| bomb_detonated (0.082 ±.04) | 0.078 ✅ | 0.079 ✅ | 0.078 ✅ | 0.085 ✅ |
| defuse (0.160 ±.04) | 0.185 ✅ | 0.196 ✅ | 0.182 ✅ | 0.182 ✅ |
| time_expired (0.043 ±.04) | 0.056 ✅ | 0.022 ✅ | 0.058 ✅ | 0.023 ✅ |
| attack (0.509 ±.04) | 0.508 ✅ | 0.531 ✅ | 0.483 ✅ | 0.519 ✅ |
| opening_duel (0.437 ±.04) | 0.449 ✅ | 0.458 ✅ | 0.432 ✅ | 0.438 ✅ |
| pistol (0.500 ±.05) | 0.469 ✅ | 0.478 ✅ | 0.397 ❌ | 0.416 ❌ |
| full vs full (0.500 ±.05) | 0.486 ✅ | 0.510 ✅ | 0.454 ✅ | 0.498 ✅ |
| **verdict** | **8/8** | **8/8** | **7/8** | **7/8** |

Pistol (161–320) was already failing on main (a known pre-plant issue, HANDOFF §5 P0-1, not this work);
it is not made worse (0.397 → 0.416, slightly closer). No other of the 8 regresses.

### Economy cells (part of the 15, not the 8)

| cell (target ±.05) | main 1–160 | **fix 1–160** | main 161–320 | **fix 161–320** |
|---|---|---|---|---|
| full vs eco (0.960)* | 0.905 ❌ | **0.953 ✅** | 0.934 ✅ | **0.988 ✅** |
| semi vs eco (0.928) | 0.958 ✅ | **0.991 ❌** | 0.931 ✅ | **0.981 ❌** |
| eco vs full (0.040)* | 0.099 ❌ | 0.147 ❌ | 0.077 ✅ | 0.058 ✅ |
| semi vs semi (0.500) | 0.503 ✅ | 0.511 ✅ | 0.469 ✅ | 0.507 ✅ |
| eco vs semi (0.072) | 0.060 ✅ | 0.060 ✅ | 0.079 ✅ | 0.081 ✅ |
| full vs semi (0.681) | 0.694 ✅ | 0.716 ✅ | 0.677 ✅ | 0.720 ✅ |
| semi vs full (0.319) | 0.313 ✅ | 0.325 ✅ | 0.329 ✅ | 0.335 ✅ |
| **judged total (/15)** | **13/15** | **13/15** | **14/15** | **13/15** |

*`full`↔`eco` and `eco`↔`full` on Ascent are small-sample "don't tune" priors (VALIDATION_BASELINES §1,
n≈25); judge by trend. The integrator's own eco-gate (economy.md) accepted the `eco`-vs-`full` 0.099
miss as inside the prior interval [0.007, 0.195] with a non-buy (close-out) cause.

### Close-out (report-only, the thing this fixes)

| | main 1–160 | fix 1–160 | main 161–320 | fix 161–320 |
|---|---|---|---|---|
| all time-outs (share of rounds) | 0.0561 | 0.0222 | 0.0578 | 0.0233 |
| …attack man-up & no plant | 78 | **0** | 82 | **0** |
| full-vs-eco time-out share | 0.057 | 0.006 | 0.060 | 0.004 |
| full-vs-eco plant rate | 0.810 | 0.840 | 0.850 | 0.860 |

## 4. Trade-offs / what it exposes

- **`semi` vs `eco` overshoots** (0.928 target; 0.991 / 0.981). The ~3% of `semi`-vs-`eco` rounds that
  used to time out were the freeze; converting them to the attack wins they should have been pushes the
  cell up. Underneath: the sim's **eco *defence* wins only ~1–2%** of these, where VCT says ~7%. The
  freeze was accidentally propping the cell to the right number. This is an **eco-defence** gap (entry
  trades / a 1–2-defender clutch, not close-out), outside this change's lever — fixing it from the
  attack side would mean an artificial nerf (forbidden). Flagged for the defence/eco owner.
- **`eco` vs `full`** stays a miss on 1–160 (0.099 → 0.147) and passes 161–320 (0.058). The cell mixes
  eco-defence-vs-full-attack (now lower, correct) with eco-attack-vs-full-defence (the eco attack also
  stops freezing, so higher); net up on 1–160. 0.147 is above the Ascent prior 0.040 (n≈25, don't-tune)
  but within the all-maps international figure (0.115) ± sampling. Trend only, per the brief.
- The judged total drops 14→13 on 161–320 purely from `semi` vs `eco`. The gate (original 8) is the
  flip criterion and holds, so the fix ships on; the integrator can weigh the `semi`-vs-`eco` cell at
  the integration gate (e.g. pair it with an eco-defence clutch/hold pass).

## 5. Eco-defence stack — attempted, measured negative, left behind a flag (default OFF)

Follow-up to the `semi` vs `eco` overshoot above: can realistic eco-defence behaviour win back the
~7% VCT steal the freeze used to supply? Implemented `MatchConfig.ecoDefenseStack` /
`TeamPolicyOptions.ecoDefenseStack` (`sim-batch --eco-stack`): on an **eco defence, pre-contact**,
group a stack onto the likely site (cross-round attack read, else alternate by round), pulling up to
two defenders off the other side but leaving one back for info, so the cheap guns meet the entry in a
close crossfire instead of losing five spread 1v1s. Reuses the rotation machinery
(`decideEcoStack` → `commitDefenseRotation`) and the combat engine's own extra-gun (crossfire) term.

**It does not work, and the flag stays OFF.** Measured why first (fix bundles): eco defences win only
when they get an early multi-kill crossfire, and that is rare because they are spread and lose close
1v1s (eco-defence opening-duel win 0.21 / 0.27). But stacking at zone granularity does not reproduce
the VCT steal:

| seeds 1–160 (real rosters, Ascent) | close-out fix (flag off) | **+ eco-stack (flag on)** |
|---|---|---|
| semi vs eco (0.928 ±.05) | 0.991 ❌ | 0.986 ❌ (barely moves) |
| eco vs semi (0.072) | 0.060 ✅ | 0.058 ✅ (unchanged) |
| full vs semi (0.681 ±.05) | 0.716 ✅ | **0.738 ❌** (economy cascade) |
| eco vs full (0.040 small-sample) | 0.147 ❌ | 0.115 ❌ |
| eco-defence round win | 0.026 | 0.033 |
| eco-defence opening-duel | 0.207 | 0.216 |
| judged total | 13/15 | **12/15** |

Original 8 stay 8/8, but the target cell (`semi` vs `eco`) does not come into tolerance and `full` vs
`semi` regresses, so there is no case to default it on. **Why it fails:** the combat crossfire term
only fires for a *stationary* supporting defender with line of sight to the entry at the moment of the
duel; pulling defenders across the map at zone granularity gets them caught in transit (they lose the
very duel they were sent to win) or staged on the site without sight of the entry the attack actually
uses, and it trades away the pre-aim hold they already had. Moving them fast to set up first makes it
worse (loud footsteps read by the attack; opening-duel 0.17). Code kept behind the flag (inert when
off; byte-identical to §2) as the starting point for a proper attempt.

## 6. Remaining / next step

1. **Eco-defence is too weak** (`semi` vs `eco` 0.98 vs 0.928; eco-defence wins ~2–3% vs VCT ~7%). The
   real fix is not an attack-side or a zone-level reposition (see §5): it needs sub-zone close-range
   positioning (two or three cheap guns on one choke with mutual sight, set during the buy phase, held
   stationary) or an eco-specific combat read — a larger modelling change owned by the defence/eco
   area. Do **not** reach for it with a constant nerf of the attack.
2. Pistol 161–320 (0.416) is unchanged territory (HANDOFF §5 P0-1).
3. The close-out behaviour is now entirely emergent from the spike model + the execute/recover policy;
   if a future change adds an explicit man-advantage "hunt vs re-plant" policy branch, gate it against
   these numbers (time_expired is now 0.022/0.023, already under the real 0.043 — do not push it lower).

## Notes / ownership

- **Close-out fix (§2, default on):** one-line change in two spots of `round-simulator/src/simulator.ts`
  (the spike-drop condition). Round-simulator (engine truth), touched minimally for the P0-2 close-out I
  own (pre-plant finish + plant decision). No overlap with session C's post-plant/gaze — this is strictly
  *pre*-plant (the carrier dies before the spike is down).
- **Eco-defence stack (§5, flag default OFF):** `TeamPolicyOptions.ecoDefenseStack` + `decideEcoStack` in
  `team-engine/src/policy.ts`, threaded through `match-runner` `setup.ts` / `match.ts`
  (`MatchConfig.ecoDefenseStack`) and `sim-batch --eco-stack`. It is a pre-plant **defence** behaviour
  (eco rounds only) and touches no post-plant/retake path, so it does not overlap session C. Inert when
  off (gated on the flag; the shared rotation `urgent` term was left unchanged). Kept as a documented
  negative result, not shipped.
- Determinism preserved (no RNG added; the close-out fix changes behaviour only in rounds where a carrier
  dies mid-plant, deterministically per seed). Tests: round-simulator 166 pass / 1 skip; match-runner
  135; team-engine 175; typecheck clean.
