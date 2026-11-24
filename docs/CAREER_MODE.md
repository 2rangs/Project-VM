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
  that needs the manager. The season's last day (15 September, after Champions in every year) is a
  stop of its own; leaving it runs the season transition.
- **Season transition** (`endSeason`): the review is recorded (stage placings, the board's
  objective met or not), `onSeasonEnd` hooks run, then `advanceSeason(world, { mapsPlayed })`
  with the maps every player of a league team of ANY region really played this season (0 for those
  who never played), so development uses real minutes. Then the next season's four leagues and
  circuit are built and `onSeasonStart` hooks run. The days from 16 September to the next January
  belong to the new season (offseason; nothing is scheduled).

## 3. Competition: four leagues and the international circuit

Built like the real circuit's shape (`schedule.ts`, `circuit.ts`, `progress.ts`; constants in
`SCHEDULE_MODEL` / `CIRCUIT_MODEL`). **All four regions play in parallel** with the same dates; teams
of different regions only meet at the international events. A season:

| competition | field | format | 2026 dates |
|---|---|---|---|
| **Kickoff** | each region's 12 strongest teams that can field five (11 in China; the manager's team always in) | two groups of 6 (snake by strength), single round robin Bo3; top 4 per group to a single-elimination playoff (QF Bo3, SF Bo3, final **Bo5**) | 9 Jan – 22 Feb |
| **Stage 1** | same league, drawn from the Kickoff placings (snake) | same format | 6 Mar – 19 Apr |
| **Masters 1** | 12: the top 3 of each region by Champions Points after Kickoff + Stage 1 | 4 groups of 3 (round robin Bo3, Fri–Sun), top 2 → 8-team **double elimination**, Bo3, **Bo5 grand final** (no reset): 14 series over six days | 1–13 May |
| **Stage 2** | drawn from the Stage 1 placings | same as the regional stages | 29 May – 12 Jul |
| **Masters 2** | 12: the top 3 of each region by Champions Points after Stage 2 (everything so far counts) | same as Masters 1 | 24 Jul – 5 Aug |
| **Champions** | 16: the top 4 of each region by Champions Points after Masters 2 | 4 groups of 4, top 2 → the same double-elimination bracket | 14–26 Aug |

Competitions start on the first Friday on/after an anchor date and at least a week after the
previous one ends, so the dates shift by up to six days in other years; the season ends on
15 September, tested to be after Champions for 2026–2040.

**Champions Points** (CP, per season): a placing earns points in every competition
(`stagePoints` 8/6/5/4/2/2/2/2 for the first eight of a regional stage; `mastersPoints`
12/10/8/7/5/5/4/4/1×4; `championsPoints` 16/13/10/8/6/6/5/5/2×4/1×4). Teams of a region are ranked by
CP (tie: team strength, then id); the quota above qualifies them, and a region with too few
eligible teams is topped up from the best remaining CP so every event is full. The field is seeded by CP
(snake into the four groups); the draw is not region-protected, so teams of one region can meet
inside a group. The double-elimination bracket: UB R1 A1–B2, C1–D2, B1–A2, D1–C2; LB R1 losers of
the UB R1 pairs; UB R2; LB R2 winners of LB R1 against the UB R2 losers (crossed); UB final; LB R3;
LB final (LB R3 winner against the UB final loser); grand final. Placings: grand-final winner and
loser, LB final loser, LB R3 loser, LB R2 losers, LB R1 losers, then group exits by record.

Regional standings order: series wins → map difference → round difference → head-to-head → team id.
Fixture seeds come from (career seed, fixture id), so a result never depends on the order fixtures
are played in. Per season: 3 stages × (30 group + 7 playoff) × 4 regions = 444, plus Masters 26 ×
2 and Champions 38 = **534 series**, of which the manager plays 11–14 in their league plus any
international matches.

**News** (inbox, ko/en): after each competition the points race of the manager's region (rank,
points, the cut for the next event); the draw of each international event (field, top seed) and
whether the manager is in (group, opponents, first match) or missed it (the cut, who went); group
stage through/out; the next bracket opponent; each event's champions; the manager's own result
and points; **upsets** — a knockout or international playoff won by a team whose strength is at
least 0.08 (≈ 1.6 sd) below the loser's (`UPSET_GAP`), a handful per season.

## 4. Simulating other teams' series: world sim depth

Per season there are **519 series** (four leagues, three international events, 22 of them the
manager's). The manager's own match is always played for real; the AI series are played by the
**world sim depth** (Settings; localStorage `pv-career-depth`; FM style):

| depth | engine plays | quick estimate plays | measured season time (this Mac) |
|---|---|---|---|
| `league` (**default in Electron**) | the manager's own league (92 series) | other regions' leagues (318) and the international events (87) | ≈ 8 min of background simulation |
| `quick` (default in the plain browser, which has no engine process) | nothing | all 497 | **0.6 s** |
| `full` | everything | nothing | ≈ 36 min |

The engine path: each series goes to a long-lived tsx subprocess (`scripts/career-sim.mts`) and is
played by `runSeries` — veto and every map — with both teams' career fives (readiness applied),
analysts and map practice, scouting off; one series at a time, never on the UI thread; progress after
each series (the match-day `LoadingScreen` in a box on Home). Engine cost per series: 3.0 s
(international) to 5.1 s (own league), ≈ 4 s on average with other jobs on the machine
(`tools/career/season-timing.mts`).

**The quick estimate** (`quick-sim.ts`): rounds from the two fives' ability *today* (readiness
applied) and the teams' map pools:
`P(round) = sigmoid(roundSlope · (s_home − s_away) + mapSlope · (share_home − share_away) + σ · z)`,
with the real map win shares since 2025 (shrunk), ban/pick of maps, and one form draw `z ~ N(0,1)`
per map. Constants and how well they are known (`tools/career/calibrate-quick-sim.mts`: 120 Bo3
series played by the engine between random teams of the four regions with their career fives,
286 maps; the engine results are committed in `tools/career/calibration-data.json`, so a re-fit
takes seconds without `--refit`):

- `roundSlope` = **7.9** (fit 7.76 ± 0.63; the ability-difference sd is 0.046, so 1 sd ≈ 0.36 logit);
- `mapSlope` = 0.4 (fit 0.28 ± 0.21 — the map-pool effect is weak and barely significant);
- the engine's round-win intercept is −0.017 (no attack-side bias to correct).

**Not settled — the reason the default keeps the engine for your league.** With these constants and
no per-map noise the series-level check was overconfident: the series the quick model gave under 30%
were won 28% of the time (predicted 13%, n = 54), and the Brier score of the quick model was 0.197
against 0.25 for always saying 50% — better than chance, not calibrated. Engine rounds are not
independent (round form, tactics, mastery), so series are more upset-prone than the independent-
rounds model says. The per-map noise term σ (`mapNoiseSd`, currently **0.3, an unfitted
provisional**) is there to fix that; the scan over σ and the round slope against the cached engine
series (`calibrate-quick-sim.mts` without `--refit`) was queued but not run before the wrap-up, so
σ is not verified. Until it is, results of other regions and of the international events (the
quick path at the default depth) are somewhat too predictable; the manager's league is engine-played.

**Form** per player, updated per map played:
`perf = ½·roundShare + ½·k/(k+d)` (round share alone when K/D is unknown), `form ← form + 0.25·(perf − form)`, 0.5 = par. Form is an output (it feeds the head coach's report); the engine reads fatigue and sharpness through readiness (§4a), not form.

## 4a. Lineup and match readiness

Before the manager's match the lineup screen shows the squad (roster + academy) with CA estimate,
form, maps, **fatigue**, **sharpness** and **readiness**; the chosen five are kept for later matches
(`career.lineup`). Readiness `R = (1 − 0.25·max(0, f − 0.3)) · (1 − 0.08·(1 − s))` scales each
ability attribute toward the league floor for that match, `x' = floor + R·(x − floor)` — no flat
bonus. `f` is the club layer's training fatigue plus 0.03 per map played; `s` is sharpness
(`s ← s + 0.2·(1 − s)` per map, `exp(−days/30)` fade, 0.6 at the start). The engine's rosters
(`SeriesStartRequest.rosters`, the background sim) and the quick estimate both read `x'`. Map
practice from the training plan is added to the team's map records for mastery
(`SeriesStartRequest.practice` → series `mapRecords`; docs/CLUB_OPERATIONS.md §5, §7a).

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
  (`career`, order 0) handles the board objective and monthly reports; the **club layer**
  (`club`, order 10, docs/CLUB_OPERATIONS.md §7) runs contracts, finance, transfers and training
  on the same calendar and inbox.
- Randomness only from `ctx.rng(label)` (seeded by career seed, hook id, date, label); saved state
  only through `ctx.ext(init)` (plain JSON in `career.ext[id]`). Both keep saves deterministic.
- Inbox drafts: `{ category, key, params?, from, options?, ref?, text? }`. The desktop renders
  `inbox.<key>.title/body` (and `inbox.<key>.option.<id>`) from its ko/en strings; string params
  that match `career.enum.<value>` are translated. A module without strings passes
  `text: { en: { title, body }, ko: { title, body } }`. Items with `options` stop Continue.
- In the desktop a module registers its hook by being imported once (e.g. from
  `career/session.ts` or its own screen module) before Continue runs.

## 7. Not done

- **Competition:** regional playoffs are single elimination (only the international events are
  double elimination); no promotion/relegation; the international draw is not region-protected;
  no Kickoff-style regional qualification to a lower division; no prize money per event (the club
  layer pays by regional placing).
- **Matches:** every map is simulated on Ascent geometry (`SIMULATED_GEOMETRY`) as everywhere in the
  series layer; no substitutions during a series; fatigue is one number per player.
- **World:** no injuries (the engine has none); AI squads change in `advanceSeason` and the AI
  market; no board confidence or sacking beyond the board's money messages. After contracts
  expire the manager's squad is not refilled (below five players the lineup cannot be confirmed;
  Home does not warn yet).
- **UI:** Opponent Report and Tactics still read the dataset, not the career world. The Quick
  Match sandbox uses dataset rosters; only the career path passes world rosters.
- **Performance:** engine depths cost minutes (`league` ≈ 8, `full` ≈ 36 per season); there is no
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
- `packages/career/test/club.test.ts`: contracts, three seeded seasons inside careers (economy bands,
  determinism), counterfactual transfers, loans, expiry and renewal, training focus → development,
  map practice → mastery continuity.
- `career-mode.test.ts` also covers: the manager's squad untouched by the season loop; lineup
  choice; the readiness formula (checked against its stated numbers); fatigue and sharpness after
  maps.
- `apps/desktop/test/e2e.career.test.mjs` (`test:e2e:career`, Electron) and `e2e.club.test.mjs`
  (`test:e2e:club`): the whole loop — see docs/CLUB_OPERATIONS.md §7b. `tools/career/*.mts` are the
  calibration and timing scripts (heavy; run through `heavy-run.sh`).
