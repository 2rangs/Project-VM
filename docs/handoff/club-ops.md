# Handoff: club operations (contracts, finance, transfers, training, board, staff, morale)

Branch `claude/happy-newton-649a94`. Merged origin/main 65180b9. Not pushed. Design, formulas and constants: `docs/CLUB_OPERATIONS.md` (§1–7 base layer, §9–12 depth). Constants: `packages/career/src/club/constants.ts` (`CLUB_MODEL`, `DEPTH_MODEL`, `CLUB_FLAGS`).

## Done, default ON (no effect on the default sim)
- **Base club layer** (earlier rounds, integrated into career mode by the integrator): contracts, finance and ledger, transfers, loans, free agency, AI market, training focus → development, map practice → mastery.
- **Contracts depth** (`club/people.ts`, `club/transfers.ts`):
  - Agents: hardness h → agent fee (3–10 % of wage·years, buyer pays) and the player's acceptance margin (`acceptMargin + 0.15·h`).
  - Bonuses: signing, loyalty, per-win, per-title. They are valued in the player's utility as an effective wage and booked when due (signing at signing, win after each won series, title at a regional win, loyalty at a full-term expiry).
  - Release clause and sell-on terms; the sell-on pays out on the next sale.
  - Renewal feelings (morale, playing-time share vs. role, ambition vs. club level) with a flat refusal below −0.45.
  - Free-agent expectations fall 6 % a month unsigned (floor 60 %).
- **Board** (`club/board.ts`):
  - Objectives from stature (strength rank in the region) and budget; an international target for top-3 targets.
  - Confidence moves with results against expectation, monthly finances and the season review.
  - Warning below 35 %, sack below 15 % (a flag plus an inbox item).
  - Requests (transfer, wage, staff budget; facilities), one of each kind per season.
  - Facilities feed the coach-factor input of development; neutral at 0.5, so worlds without facilities develop exactly as before.
- **Staff market** (`club/staff-market.ts`):
  - New **physio** role (physiotherapy → weekly fatigue recovery ×(0.75 + 0.5·p)) and head-coach **motivation** (→ morale target).
  - Demand = market wage · (1 + 0.3·(quality − club reputation)).
  - Hire replaces the holder of the post (with severance); dismissal pays severance.
  - A better scout narrows the estimate bands (tested).
- **Morale** tracked weekly for the manager's squad, plus a ±0.03 swing for the five after each series. It drives renewals and the UI.
- **Desktop:**
  - New Board and Staff screens (nav `board`, `staff`).
  - A bonuses & clauses section and an agent line in the offer form.
  - A morale column in Training.
  - The club e2e step covers Board and Staff.
  - ko/en strings for all of it.

## Behind a flag (default OFF)
- `CLUB_FLAGS.moraleInMatch` (`setClubFlags({ moraleInMatch: true })`): morale moves the career match roster. Ability span ×(1 + 0.1·d); consistency ± 0.2·d → discipline and round-form σ; clutch ± 0.2·d → decisionMaking and pressure form. All of it goes through match-runner's existing roster → profile path; no match-runner or round-simulator file changed. Off by default because it was not gated and the measurement showed no effect. At neutral morale, and with the flag off, the roster is byte-identical (tested).

## Measured
Morale counterfactual (`packages/career/test/morale-match.test.ts`, opt-in `PV_MORALE_MATCH=1`, real engine, same five, opponent and seeds). Rounds won by the five:

| run | high | neutral | low | rounds played |
|---|---|---|---|---|
| decision terms only, N = 16 | 142 | 145 | 151 | 340 |
| with the level term, N = 30 | 281 | 279 | 281 | 628 |

No measurable effect. I did not run the real-roster 160-match gate: nothing on the default path changed (the default game has no career rosters).

## Gate status (this branch, after the merge)
- `packages/career`: tsc clean; vitest 68 passed, 1 skipped (the opt-in engine test).
- `apps/desktop`: tsc clean, `test:unit` 62/62, build OK.
- **Not run in this round:** `test:e2e:club` and `test:e2e:career`. The lock was full and the integrator asked for no further heavy runs; it will run the combined gate. The club e2e step now also clicks Board and Staff.

## Unfinished, with the exact next step
1. **Morale in the match.** Measure the engine's response to roster ability: one match pair with every ability attribute at the floor vs. as rated, same seed. That probe was cancelled at wrap-up. Then size `DEPTH_MODEL.moraleAbility` from that response, re-run the opt-in test at N ≥ 30, and turn the flag on only after the real-roster gate.
2. **The sack:** career mode does not end the career or offer a new job. `club.board.sacked` is the hook point.
3. **AI clubs** have no board or bonuses, and their morale is not tracked: it is the derived value from form and role (one model, see below).
4. **Merge with `claude/loving-meninsky-767c08`** (scouting knowledge). Its branch replaces `estimateAbility(w, teamScout(w, X), p)` with `estimateForTeam(w, X, p)` in `club/market.ts`, `club/transfers.ts` and `career/career.ts`. This branch added one more such call, in `playerUtility` (default release clause); switch it too. The interface is agreed in the shared notes (`scouting-interface.md`).

## Morale unification (branch `morale-unify`, from origin/main 85eadc8)
- **One model:** `development.ts` `moraleOf(world, player, form)`. The club's tracked value (`club.morale`) is the state for the manager's squad. Everyone else gets the derived value (`developmentMorale`: form, role vs. ambition, temperament), exactly as development had it.
- **Tracked target:** `T = derived core + results + pay + coach`. With average results, pay and coach, the tracked player settles at his derived value. The playing-time term left T (role vs. ambition covers it); it still drives renewals. `DEPTH_MODEL.wTime` was removed.
- **Readers:** development at season end (`season.ts`), renewals (`transfers.ts`), the match roster (`readiness.ts`, still behind `moraleInMatch`, off), the Training morale column, and the Scouting own-player panel, which now says whether the value is tracked or estimated.
- **Tracked form:** the career hook passes per-player form to the weekly morale step.
- **Default sim and AI development** are unchanged. With no tracked morale, `advanceSeason` gives the same result as before, and the same as a world without a club (tested).
- **Saves:** no `club.morale`, or no entry for a player → derived; stored entries are kept.
- **Gate:** career vitest 103 passed / 1 skipped, tsc clean; desktop tsc clean, `test:unit` 79/79, build OK. `test:e2e:career` passes ("signed Derialy, played 0–2 on 2026-01-10 with a chosen five; 3 engine-played AI series; season 2026 played out, contract expired, season 2027 open"); `test:e2e:club` passes ("signed carpe", Board and Staff steps included). Both ran through heavy-run.sh; the regenerated `apps/desktop/docs` screenshots were discarded.

## Known risks
- **Flag on:** with `moraleInMatch` on, untracked players (AI clubs) now carry their derived morale into the match roster instead of a neutral 0.5. That only matters when the flag is on.
- **Generation:** adding `physio` to `STAFF_ROLES` and `motivation` to the head coach changes world generation (staff count, staff RNG draws). Same-seed worlds differ from earlier builds; saved careers load (missing physio is treated as neutral, and the next season fills it).
- **Career play without the flag:** physio quality changes training fatigue → readiness in career matches. This was already true for fatigue; the default sim is untouched.
- **Overwritten note:** I overwrote the generated-players session's `scouting-interface.md` once by mistake. They restored it (their version first).
