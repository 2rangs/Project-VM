# Career mode

The desktop app is a career game now: it opens on a start menu, a career is a calendar the
manager advances with **Continue**, and the match engine runs only when a match is played.

Code: `packages/career/src/career/*` (calendar, competition, day loop, hooks, saves; pure TS) and
`apps/desktop/src/renderer/screens/career/*` + `career/{session,view}.ts` (screens, session
store), `apps/desktop/scripts/career-sim.mts` + `src/main/career-host.ts` (background
simulation, save slots).

## 1. Flow

```
start menu ──New career──▶ profile ─▶ region + team ─▶ save slot ─▶ (world generated) ─▶ Home
    │  Continue / Load (save slots) ──────────────────────────────────────────────────▶ Home
    │  Settings: language, background simulation (full engine / quick estimate)
    │  Quick Match: the sandbox — Match Day, Series, Squad, Dev tools, as before
    └  Quit

Home ─Continue─▶ day by day … stops at:  match day │ a message that needs an answer │ season end
       match day ─▶ series screen (veto, maps one-shot or round by round) ─▶ record ─▶ Home
```

- **No engine at launch.** The start menu shows nothing behind it; the old default (Match Day)
  is under Quick Match.
- **New career.** Manager name (2–32 characters, used only in the save and inbox) and
  nationality. Region tabs list every team of the region that can field five, strongest first,
  with an overview: roster (scout's CA estimate, generated players tagged), region strength
  rank, map pool from real map records since 2025 (`src/data/team_maps.json`), staff. The world
  is built with `@pv/career` from a seed shown on the team step (same seed → same world and
  schedule), and saved to the chosen slot.
- **Home.** Date, next fixture, last result, the group table, the starting five (CA estimate,
  maps played, form), the latest inbox. Continue sits on Home and in the top bar; while AI
  fixtures are simulated it shows a progress bar (`n / total series`, the pairing being played).
- **Match day.** "Go to the match" opens the existing series screen locked to the fixture:
  our team is series team A, the opponent B, format and seed from the fixture, our analyst from
  the career staff, and **both teams' five from the career world** (`SeriesStartRequest.rosters`
  → `SeriesTeamConfig.roster` → every map's `MatchConfig.rosters`; the scouting film uses them
  too). "Record result" writes the series into the career. "Instant result" skips the match
  (quick estimate, below) — the only option in the plain-browser build.
- **Inbox** (data-driven, ko/en): welcome, the board's objective question (needs an answer),
  schedule release, squad overview, new prospects, results, playoff qualification / elimination,
  the next playoff opponent, stage champions, the stage 2 draw, the season review, squad changes
  after the season, monthly form reports (coaching staff) and free-agent reports (scout, only when
  the top name changes). Club-operation modules post their own (§6).
- **Schedule.** Month calendar (our matches with opponent or score, league match days with a
  count, today outlined) and the fixture list with map scores; our team or the whole league.
- **Standings.** Per stage: both groups (series W–L, maps, round difference; playoff places
  marked) and the playoff bracket with seeds shown until they are known.

## 2. Calendar model

- Dates are ISO `YYYY-MM-DD` strings with UTC arithmetic (`calendar.ts`), so a save reads the same
  on every machine.
- A career opens on **5 January** of the dataset season (2026). The state holds one date; Continue
  first *leaves* today (the manager's match must be played and answers given; the day's AI
  fixtures are simulated; hooks run), then advances one day at a time and stops at the first day
  that needs the manager. The season's last day (1 September) is a stop of its own; leaving it
  runs the season transition.
- **Season transition** (`endSeason`): the review is recorded (stage placings, the board's
  objective met or not), `onSeasonEnd` hooks run, then `advanceSeason(world, { mapsPlayed })`
  with the maps every player of a league team really played this season (0 for those who never
  played; players outside the league keep the status estimate), so development uses real minutes.
  Then the next season's schedule is built and `onSeasonStart` hooks run. The days from
  2 September to the next February belong to the new season (offseason; nothing is scheduled).

## 3. Competition

Loosely on the real circuit's league stages (`schedule.ts`, `SCHEDULE_MODEL`):

| | format | dates |
|---|---|---|
| League | the region's 12 strongest teams that can field five (the manager's team always in) | |
| Stage 1 groups | two groups of 6 (snake seeding by strength), single round robin, **Bo3** | weekly from the first Friday of February, Fri–Sun |
| Stage 1 playoffs | top 4 per group; QF cross-group 1v4 / 2v3 **Bo3**, SF **Bo3**, final **Bo5** | the next two weekends |
| Stage 2 | drawn the day after the Stage 1 final from the Stage 1 placings (snake), same format | from the first Friday of May, at least 3 weeks after the final |

Standings order: series wins → map difference → round difference → head-to-head → team id.
Fixture seeds come from (career seed, fixture id), so a result never depends on the order
fixtures are played in. 30 group series + 7 playoff series per stage; 74 per season.

## 4. Simulating other teams' series

AI-vs-AI series are simulated when the day they are on is left.

- **Full engine (default in Electron):** each series is sent to a long-lived tsx subprocess
  (`scripts/career-sim.mts`) and played by `runSeries` — veto and every map — with both teams'
  career fives and analysts, scouting off. One series at a time, never on the UI thread; the
  renderer gets progress after each series. Per-player kills/deaths are read from the engine's
  kill events (`atk1..5` / `def1..5` are roster order of the attacking / defending slot). Measured
  ≈ 10–25 s per Bo3 on this Mac, so a full season of AI series is ~20–30 minutes of background
  time spread over its match days.
- **Quick estimate** (setting, browser build, tests, and the fallback when an engine batch fails —
  the Home screen then says so): `quickSeries` plays rounds from the two fives' ability:
  `P(round) = sigmoid(2.5 · (s_home − s_away + comfort_home,map − comfort_away,map))`, `s` = mean
  current ability of the five, `comfort` a stable per-team, per-map lean (σ 0.01). Maps are first
  to 13 with a 2-round lead. Kills are spread by ability (`exp(8·(ca − team mean))` + noise). It
  exists to keep the calendar fast; it is not the engine.

**Form** per player, updated per map played:
`perf = ½·roundShare + ½·k/(k+d)` (round share alone when K/D is unknown — the manager's own
series records map scores only), `form ← form + 0.25·(perf − form)`, 0.5 = par.

## 5. Saves

- Three slots, `<userData>/saves/slot{1,2,3}.json` (`PV_SAVES_DIR` overrides; the browser build
  uses localStorage). A save is the whole `CareerState` — world, calendar, fixtures and results,
  stats, inbox, history, objective, hook state — as one JSON document with a small `meta` header
  read by the slot list. Writes go through a temp file + rename.
- **Autosave** into the career's slot whenever Continue stops, after an inbox answer and after the
  manager's match is recorded. Not after every single day of a long Continue: one Continue can
  cover 100+ days and a save is ~2 MB.
- Loading gives back exactly the saved state; Continue from a load plays out identically to
  Continue from the live state (tested on a whole half-season).

## 6. Hook API for club operations (stable)

```ts
import { registerCareerHook } from '@pv/career';
registerCareerHook({
  id: 'finance',                        // the ext slot and inbox `source`
  order: 100,                           // optional; ascending, then id
  onCareerStart(world, ctx) {},
  onDay(world, date, ctx) {},           // every day, after that day's fixtures
  onMonth(world, date, ctx) {},         // the 1st, after onDay
  onMatchResult(world, fixture, ctx) {},
  onSeasonEnd(world, season, ctx) {},   // BEFORE advanceSeason
  onSeasonStart(world, season, ctx) {}, // after advanceSeason and the new schedule
  onAnswer(world, item, answer, ctx) {},// an inbox item this hook posted was answered
});
// ctx = { career, world, date, post(draft), rng(label), ext(() => init) }
```

- Hooks run synchronously inside the day step, in `order` then `id`; the core's own hook
  (`career`, order 0) handles the board objective and monthly reports.
- Randomness only from `ctx.rng(label)` (seeded by career seed, hook id, date, label); saved state
  only through `ctx.ext(init)` (plain JSON in `career.ext[id]`). Both keep saves deterministic.
- Inbox drafts: `{ category, key, params?, from, options?, ref?, text? }`. The desktop renders
  `inbox.<key>.title/body` (and `inbox.<key>.option.<id>`) from its ko/en strings; string params
  that match `career.enum.<value>` are translated. A module without strings passes
  `text: { en: { title, body }, ko: { title, body } }`. Items with `options` stop Continue.
- In the desktop a module registers its hook by being imported once (e.g. from
  `career/session.ts` or its own screen module) before Continue runs.

## 7. Not done

- **Competition:** no Kickoff, Masters or Champions; single- instead of double-elimination
  playoffs; no promotion/relegation; only the manager's region has a league — other regions'
  players develop on the status estimate of minutes.
- **Matches:** the manager's series records map scores but not per-player K/D (the series view
  does not carry it), so their form uses round share only. Lineups are always the roster's first
  five; there is no lineup or substitution choice before a match. Every map is simulated on Ascent
  geometry (`SIMULATED_GEOMETRY`), as everywhere in the series layer.
- **World:** no injuries (the engine has none); AI squads change only in `advanceSeason`; the
  manager's squad also changes there automatically (signings/releases by the scout's estimate)
  until the club-operations session adds contracts and transfers. No board confidence or sacking.
- **UI:** the loading surface is a simple `CareerProgress` with the same props as the match-day
  session's `LoadingScreen` (not on main yet) — swap it in when that lands. Opponent Report and
  Tactics still read the dataset, not the career world. The Match Day sandbox (Quick Match) uses
  dataset rosters; only the career path passes world rosters.
- **Performance:** a full-engine season is ~20–30 minutes of background simulation; there is no
  parallelism (one heavy job at a time on this machine by design).

## 8. Tests

- `packages/career/test/career-mode.test.ts` (vitest): schedule shape and seeding; Continue stops
  (board question, match day, refusing to leave an unplayed match day); a whole season to the
  season end and the transition through `advanceSeason` with real minutes; same seed → identical
  season (serialized byte for byte); save/load mid-season then both play on to the same end
  state; hooks (days, months, results, season end/start, ext state, inbox posts).
- `packages/career/test/match.test.ts`: a career lineup plays a series (`SeriesTeamConfig.roster`
  reaches every game's `MatchConfig.rosters`).
- `apps/desktop/test/career-mode.test.ts` (`test:unit`): the manager's series mapped into the
  fixture home/away, standings and minutes; every inbox message of a season renders in ko and en
  with no raw keys or placeholders; desktop save round trip.
- `apps/desktop/test/e2e.career.test.mjs` (`test:e2e:career`, Electron): start menu → new career →
  board question → first match day → the series through the engine → recorded → in the standings →
  the next Continue plays AI series through the engine in the background → main menu → Continue
  reproduces the saved day and standings.
