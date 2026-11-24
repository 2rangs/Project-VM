# Handoff: generated players, scouting knowledge, development, academy

Branch `claude/loving-meninsky-767c08`. Full design is in `docs/GENERATED_PEOPLE.md` (§1–8 regens, §9 knowledge, §10 development drivers, §11 academy, §12 desktop, §13 not done).

## Done (all default-on; none of it touches the match engine)
True attributes still drive every match. These are career-layer and desktop features only, so no real-roster sim gate applies.

- **Regens** (generated players and staff, original names): already on main (c73e72d, 75e2764).
- **Knowledge fog** (`packages/career/src/knowledge.ts`): the manager's club sees other clubs' players as ranges. The width depends on knowledge κ, which comes from a reputation floor, scout assignments (player/region/league/youth, applied on Mondays), matches watched and a youth trial, and decays over time. The true value is always inside the range. Own players get a small coaching-staff error. `estimateForTeam` / `attributeRangesForTeam` give the manager's club the fog; AI clubs keep `estimateAbility`, byte-identical.
- **Scout interface agreed with club-ops** (shared note `scouting-interface.md`): scout attributes `judgingAbility` / `judgingPotential` go in; `scoutGain = 0.5 + 0.5·judgingAbility` and `{value, lo, hi}` per attribute (`estimateAttributes`) come out.
- **Development drivers** (`development.ts`, `season.ts`): growth D = Personality · Morale · Mentor, and decline is scaled by professionalism. Morale comes from form and role against ambition. The manager sets mentors. Each player stores a per-season history (at most 12 points).
- **Academy** (`academy.ts`): invite, promote, demote and loan out (through the club offer flow). An academy loanee returns to the academy.
- **Career hook** `scoutingCareerHook` (order 20) handles weekly scouting, watching matches, and season-start youth trials. It sends two inbox messages, `scouting.weekly` and `scouting.youthIntake`.
- **Desktop**: the Scouting screen has four career tabs (reports, assign, shortlist, club youth). Player pages show attribute range bars, a knowledge badge, a "scout this player" action, and an own-player panel (morale, traits, mentor, academy and loan actions, development chart). en+ko i18n has about 90 keys.

## Flags
- No new feature flag. The only switch is `AdvanceSeasonOptions.personality: false`, which turns off the personality, morale and mentor multipliers in `advanceSeason`; they are on by default.

## Measured (seed 77, 15 seasons, `packages/career/test/development.test.ts`)
- CA growth per season: +0.011 to +0.018 at ages 16–23, about 0 at 26, and −0.007 / −0.011 / −0.015 at 27 / 28 / 29.
- Mechanics (aim) start declining at 26; game sense (impact) at 30.
- 81% of generated 25–27-year-olds are within 0.03 of their PA.
- Median retirement age: 30 for signed players, 25 overall.

## Gates on the final tree (merged with origin/main 65180b9)
- Career vitest: 67/67.
- Desktop: `tsc` clean, `test:unit` 64/64, build OK.
- **`test:e2e:career` has not been run.** It was queued behind other heavy jobs and cancelled at the integrator's wrap-up. It has new scouting steps in `apps/desktop/test/e2e.career.test.mjs`: assign a youth scout and save, check ranges on a free agent's page, check reports after the first match, and check the development chart on the club tab after the season.

## Unfinished, and the next step
1. Run `test:e2e:career` (in the combined gate). If a scouting step fails, the likely cause is a testid or timing in `e2e.career.test.mjs`; the selectors are listed in GENERATED_PEOPLE §12.
2. At merge with club-ops: their `playerUtility` (default release clause) should call `estimateForTeam` instead of `estimateAbility(teamScout(...))`. The `staffMarket` / `hireStaff` calls can stay as they are.
3. §13 lists the rest: second-team matches, loans *in* for academy players, and scout reports on staff.

## Known risks
- The club-layer edits in `club/market.ts`, `club/transfers.ts`, `club/ops.ts` and `career/career.ts` (`estimateForTeam`, `Loan.returnTo`) may conflict textually with club-ops' branch.
- Saves made before this branch have no `world.scouting` or `world.development`. The hook initialises them on career start only, so an old in-progress career keeps the old unfogged view until a new career starts.
- Wider assignments produce a report on the top 3 players each week, which may be a lot of inbox traffic in long careers. Only reports from player assignments and "sign" recommendations send an inbox message.
