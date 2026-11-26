# Handoff: career depth (media·interactions·morale, scouting fog, tutorial·difficulty)

Branch `claude/pv3-career-depth` (from main 29th merge `97db384`). Backlog #7, #8, #9 from
`claude/pv3-research:docs/research/UPGRADE_BACKLOG.md`. Career package + desktop career screens only
— **no simulation-engine file changed** (round-simulator, team-engine, match-runner, `QUICK_SIM`
all untouched). Season progression time and save size are **not worse than main** (measured below).

## What shipped

### #7 Media · press conferences · player interactions → morale
- **New career hook `media` (order 30)**, built in after club(10) and scouting(20). Files:
  `packages/career/src/media.ts` (model + logic) and `media-hook.ts` (the hook). Exports in
  `src/index.ts`. State lives in the save under `ext.media` (plain JSON: chemistry, promises, a
  capped press/interaction log, pressed-fixture ids).
- **Press conferences** arrive in the inbox as items with options (they stop Continue like any
  board question). A **pre-match** presser for a notable fixture (a regional playoff or any
  international match) and a **post-match** presser for a notable result (playoff/international, or
  an upset either way). Each option applies a squad-wide morale swing (positive messages land
  harder when chemistry is high) and a chemistry move, through `onAnswer`.
- **1:1 interactions** (manager-initiated, new screen): praise / criticise (±morale, with a 10-day
  cool-off per player) and **promises** (`playTime` / `winMatch` / `trophy`). A promise gives a
  small hope lift when made and is **judged** at its due date (playing-time share), on the match
  result (winMatch) or at season end (trophy = a regional title). Kept → morale + chemistry up;
  broken → down. Resolutions post an inbox note.
- **Team chemistry** (0..1): moves with press tone and kept/broken promises, relaxes toward neutral
  weekly, and nudges squad morale a touch each week.
- **All effects land in the club layer's tracked morale** (`club.morale`, via the new
  `adjustMoraleMut`). Whether tracked morale reaches the match roster stays behind the **existing**
  `CLUB_FLAGS.moraleInMatch` flag — **default OFF, measured no effect** (HANDOFF §4). This work does
  not change that: it feeds the same `moraleOf` store the renewals and the UI already read, so the
  flag's measurement is unchanged.
- **Desktop:** `screens/career/MediaScreen.tsx` (nav `media`, TEAM group, career-only): chemistry
  meter, open-promise count, squad list with morale bars + praise/criticise/promise buttons, open
  promises, recent media log. Helper `career/media.ts`. Session actions `talkToPlayer`,
  `promisePlayer`. ko/en strings.

### #8 Scouting fog deepening (report confidence · region coverage)
The accumulation-by-scout-and-region and time-decay already exist on main (`knowledge.ts`
`knowledgeOf` fades unrefreshed knowledge with `exp(−Δdays/decayDays)`; scout `judgingAbility`
drives the gain). This round **surfaces** it:
- `knowledge.ts`: `reportConfidence(report, today)` = the knowledge a report was written with ×
  freshness (same decay), so an old report reads as less trustworthy than a fresh one; and
  `regionCoverage(w, date)` — per-region players-known / mean live knowledge / scout-assigned, so
  the manager can see where scouting is strong and where it is fading.
- **Desktop:** a **confidence** column in the report table (colour-graded, with a tooltip explaining
  knowledge × freshness) and a new **Coverage** tab (`screens/scouting/tables.tsx` `CoveragePanel`).
  Helpers in `career/scouting.ts`. A `?` help button on the scouting header. ko/en strings.

### #9 Tutorial + difficulty presets
- **Difficulty** (`packages/career/src/difficulty.ts`): `easy` / `normal` / `hard`, chosen in New
  Career (step 3), stored on `CareerState.difficulty` and resolved to three knobs on
  `club.difficulty`:
  - **finance** — the manager's starting cash (and, every season, wage/transfer budgets). easy 1.5×,
    hard 0.7×. The start wage budget is still floored to payroll (you can't pay less than contracts),
    so the felt lever is **starting balance** → transfer budget.
  - **boardTolerance** — board patience: higher starts with more confidence and lowers the
    warn/sack thresholds (`board.ts` `move()`). easy 1.5×, hard 0.65×.
  - **aiStrength** — AI transfer-market aggressiveness (buys per window, `transfers.ts`
    `aiMarketRound`). easy 0.75×, hard 1.3×.
  `normal` is the exact identity preset and a career with **no** difficulty is byte-identical to an
  explicit normal one (tested) — existing saves and the default sim are unchanged.
- **Tutorial** (`help/Tutorial.tsx`): a skippable, step-by-step first-career overlay (welcome →
  Continue → inbox → squad → scouting → media → board → done), jumps to each screen as it explains
  it, remembered in `localStorage` (`pv-tutorial-done`), replayable from the ★ on Home.
- **Per-screen help** (`help/Help.tsx`): a `?` popover on Home, Scouting and Media (extend to others
  by dropping `<Help topic="…" />` in the header and adding `help.<topic>.title/.body` strings).
- ko/en strings for all of it.

## Gates (all green)
- `packages/career`: `tsc --noEmit` clean; **vitest 128 passed, 1 skipped** (107 pre-existing + 21
  new across `media.test.ts`, `difficulty.test.ts`, `scouting-coverage.test.ts`).
- `apps/desktop`: `typecheck` clean, `build` OK, `test:unit` **78/78** (i18n ko/en key + placeholder
  parity included).
- E2E under xvfb: `test:e2e:career` OK, `test:e2e:club` OK. The career e2e gained one step: it skips
  the first-career tutorial overlay (`tutorial-skip`) before driving Home.

## Performance & save size (the "사양을 타면 안 됨" principle)
One full season, quick sim, seed 4242, 6 runs each (same machine, back to back):

| | season time | save size | Continue stops |
|---|---|---|---|
| main (`97db384`) | 995 ms | 2382 KiB | 21 |
| this branch | **954 ms** | **2387 KiB** | 32 |

- **Season time: not worse than main** (within run-to-run noise; the per-day next-fixture scan was
  made lean — it skips the other three regions' leagues, which can never hold the manager's
  fixtures). Day/week step cost is a weekly O(roster≈8) chemistry nudge + due-promise check.
- **Save size: +5 KiB (+0.2%)** — the `ext.media` block (chemistry, open promises, a 24-entry log,
  pressed-fixture ids) and `club.difficulty`. Capped lists keep it bounded.
- The extra 11 Continue stops are the playoff/international press conferences (a feature, FM-style),
  not overhead; they are gated to notable fixtures so they don't flood a league season.

## Shared files touched (merge note for the integrator)
Additive, localized changes to files other sessions (F desktop render/settings, H career stats) may
also touch:
- `apps/desktop/src/renderer/App.tsx` (+media route, +tutorial overlay, +onTutorial),
  `nav.ts` (+`media` nav item), `i18n/{ko,en}.ts` (one appended block at the end).
- `apps/desktop/src/renderer/screens/career/HomeScreen.tsx` (dateline wrapper + Help/★; the
  `home-date` test id now wraps just the date), `NewCareer.tsx` (difficulty picker).
If a session edits the same lines, these are safe to re-apply by hand (one nav entry, one route, one
string block).

## Not done / next steps
1. **Press effect on the match** is still behind `CLUB_FLAGS.moraleInMatch` (OFF). To make media
   matter in-match, size `DEPTH_MODEL.moraleAbility` from the engine's roster-ability response
   (HANDOFF §5 P2-10, club-ops handoff step 1), then gate on the real-roster suite. Media only makes
   the morale it moves *larger and more directed* — the flag decision is unchanged.
2. **Pre-match press timing** fires 0–2 days before a notable fixture via `onDay`. It does not fire
   for close league games (kept rare on purpose). Widen `notable()` if more press volume is wanted.
3. **AI clubs** still have no media/chemistry (neutral by design).
4. **Difficulty: aiStrength** only changes buys-per-window; it does not yet change AI squad quality
   of play (that would be the engine, out of scope). boardTolerance/finance are the felt levers.
5. **Help** is on Home/Scouting/Media; add `<Help topic>` + strings to Finance/Transfers/Training/
   Board/Staff/Squad for full coverage.
