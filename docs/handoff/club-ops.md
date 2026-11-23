# Handoff: club operations (contracts, finance, transfers, training)

Branch `claude/happy-newton-649a94`, based on main bcc3458. Commits: a1ab580 (packages/career), 0923f06 (desktop + docs), plus this note. Not pushed or merged. Design and formulas: `docs/CLUB_OPERATIONS.md`.

## Done and verified
- `packages/career/src/club/` (pure TS, exported from `@pv/career`):
  - `constants.ts`: every constant.
  - `market.ts`: ability index, wages, value, reputation.
  - `finance.ts`: budgets, monthly ledger, prize money, sponsorship and fanbase, board checks, reinvestment and owner-support bounds.
  - `transfers.ts`: offers, the selling club's and the player's utilities, counters, loans, free agency, renewals, releases, AI market rounds in windows.
  - `training.ts`: weekly team and individual focus, fatigue, focus factors for development, map practice → `practiceAdjustedRecords` for mastery continuity C.
  - `ops.ts`: `initClub`, `clubOnDay`, `clubOnMonth`, `clubSeasonEnd`, plus the split `clubBeforeSeasonEnd` / `clubAfterSeasonAdvance`.
  - `hooks.ts`: my own `CareerHooks` interface and a local driver.
- `season.ts`: `developPlayer(..., focus?)` and `advanceSeason(world, { focus })`. Byte-identical without focus (tested). `model.ts`: optional `World.club`.
- Desktop: Finance, Transfers and Training screens, a contract panel on the player detail, ko/en strings.
  - The store starts the club layer with NRG as the user's club, and the season button goes through `clubSeasonEnd`.
  - `+1 day / week / month` buttons run the local driver.
- Verified:
  - `packages/career` vitest 37/37 (club.test.ts: 3 seeded seasons with economy bands and determinism, counterfactual transfer decisions, expiry/renewal, loans, the release rule, focus → development direction, practice → continuity) and tsc clean.
  - `apps/desktop`: tsc clean, `test:unit` 55/55, `npm run test:e2e:club` passes (release a player, sign a free agent, he is in the wage list, set a training focus).

## Half-done / not verified
- **Not wired to career-shell's real hook API.** I wrote against my own `CareerHooks` (club/hooks.ts) because the shell's API wasn't published when I started. The shell's API is committed on `claude/festive-brattain-042f51` (c784fe1: `registerCareerHook`, in-place mutation, `ctx.ext` / `ctx.post` / `ctx.rng`). The adapter has not been written.
- **Full `test:e2e` not green.** It fails before the club step, at the nav-debug block (pre-existing per the regens handover). With that block removed, it fails at the Review `scoreboard` wait. Not investigated; no Match Day files changed here.

## Connecting to career-shell (next work, in order)
1. **Merge `season.ts`:** both branches added an options object to `advanceSeason` (shell: `AdvanceSeasonOptions { mapsPlayed }`; here: `AdvanceOptions { focus }`). Merge them into one type with both fields, and pass `focus` to `developPlayer`.
2. **Write `club/career-hook.ts`** that calls `registerCareerHook({ id: "club", ... })` and uses the existing `*Mut` functions (they already mutate in place):
   - `onCareerStart(world, ctx)`: `Object.assign(world, initClub(world, { userTeamId: ctx.career.<user team>, date: ctx.date }))`, or move `ClubState` into `ctx.ext(() => …)` and have the modules read it from there instead of `world.club`.
   - `onDay(world, date)` → `clubOnDayMut(world, date)`; `onMonth(world, date)` → `clubOnMonthMut(world, date)`.
   - `onSeasonEnd(world, season, ctx)` → `clubBeforeSeasonEndMut(world, { standings })`, with standings from the shell's league table. The shell calls `advanceSeason` itself (career.ts:337), so it must also pass `focus: seasonFocus(world)` there, or the hook stores the focus in `ctx.ext` for the shell to read.
   - `onSeasonStart(world)` → `clubAfterSeasonAdvanceMut(world)`.
   - Inbox: replace `pushMessage` / `postInbox` with `ctx.post({ category, key, params, from: "board", text: { en: {title, body}, ko: {...} } })`. The bilingual title/body already exist in messages.ts.
   - Incoming bids can use `options: [{id: "accept"}, {id: "reject"}]` and `onAnswer` → `answerIncomingMut`.
   - Randomness: club code only uses seeded `streamFor(world.seed, label)` (deterministic); `ctx.rng` is optional.
3. **Desktop:** drop `ClubClock` (the +day/week/month buttons in FinanceScreen.tsx) and `store.advanceDays` in favour of the shell's Continue. Remove `DEFAULT_USER_TEAM` and use the start menu's club. Re-add my 3 route lines in `App.tsx` and the `soon` removal in `nav.ts` on top of the shell's rewritten versions. Import the hook module once from the shell's `career/session.ts`.
4. **Season loop:** keep `advanceSeason`'s squad step from auto-signing and releasing for the user's club.
5. Re-run `npm run test:e2e:club` (through heavy-run.sh) after the merge, and fix or skip the two pre-existing `test:e2e` failures.

## Known problems and limits
- **AI wages:** an AI club with five expensive starters can sit over its wage budget until contracts expire. The owner-support floor bounds its losses.
- **Match effects:** fatigue only affects training efficiency, not matches. Match Day / Series do not read the world's rosters or `practiceAdjustedRecords` yet.
- **Missing features:** no agents, bonuses, sell-on clauses or import rules (AI clubs shop in their own region only). No board objectives beyond money. No staff market screen.
- **Desktop test setup:** in this worktree, `apps/desktop/node_modules` is an untracked symlink to remaining-work-final-push's node_modules. It is not committed.
