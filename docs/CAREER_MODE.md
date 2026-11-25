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

**The quick estimate** (`quick-sim.ts`): rounds from the two fives' ability *today* (readiness applied)
and the teams' map pools,
`P(round) = sigmoid(k · (s_home − s_away) + μ · (share_home − share_away) + τ · u + σ · z)`,
`u ~ N(0,1)` once per series, `z ~ N(0,1)` per map, real map win shares since 2025 (shrunk), ban/pick
of maps, first to 13 with a 2-round lead.

**Calibration** (`tools/career/fit-quick-sim.mts`, `packages/career/src/career/quick-fit.ts`; no engine
runs — it reads the committed engine series `tools/career/calibration-data.json`: **120 Bo3s, 286
maps**, played by `runSeries` between random teams of the four regions with their career fives, seed
2026). The likelihood of an observed map score under `p` is exact (negative binomial; overtime = the
12–12 tie, then split pairs), and `u` and `z` are integrated out on a grid. Four nested models:

| model | k | μ | σ (map) | τ (series) | log-lik | AIC | 5-fold CV log-lik / series | held-out series Brier | held-out ECE |
|---|---|---|---|---|---|---|---|---|---|
| rounds only | 6.80 | 0.29 | – | – | −929.4 | 1864.9 | −7.806 | 0.204 | 0.121 |
| + per-map noise | 7.89 | 0.32 | 0.49 | – | −890.2 | 1788.4 | −7.469 | 0.197 | 0.091 |
| + per-series noise | 8.07 | 0.22 | – | 0.40 | −898.0 | 1804.0 | −7.543 | 0.200 | 0.070 |
| **both (shipped)** | **8.24** | **0.28** | **0.385** | **0.323** | **−886.7** | **1783.5** | **−7.451** | **0.201** | **0.078** |
| both + cap on the ability term | 8.24 | 0.28 | 0.385 | 0.323 | −886.7 (cap → ∞) | 1785.5 | −7.451 | – | – |

(a coin has Brier 0.25.) Noise is what the rounds-only model lacks: engine rounds are not
independent, so maps and whole series are more one-sided or closer than the lineups say — leaving
the noise out costs 43 log-likelihood units and makes the slope look flatter (6.8). Both noise terms
are supported (the series term adds 3.5 units over per-map noise alone: p ≈ 0.01); a cap that makes
the favourite's win rate saturate is not (the fit runs off to ∞). The intercept (the attack-first
side) is −0.03, negligible, and not used. **Shipped:** `roundSlope` 8.2, `mapSlope` 0.28,
`mapNoiseSd` 0.39, `seriesNoiseSd` 0.32, `abilityCap` 0.

Uncertainty (40 bootstrap resamples of the 120 series): k 8.24 ± 1.25, **μ 0.28 ± 0.29** (the map-pool
effect is not distinguishable from zero), σ 0.385 ± 0.044, τ 0.323 ± 0.063.

Reliability of the quick sim as shipped, through the SHIPPED code (`quickSeriesWith`, 200 draws per
series, the favourite = the side the model gives more than 50%):

```
Shipped constants, all 120 series (favourite's predicted vs observed series win rate; bar = 0.5 … 1.0)
  0.5–0.6  n=30  predicted 0.55 ###                            |
                   observed  0.70 ############                   |
  0.6–0.7  n=31  predicted 0.65 #########                      |
                   observed  0.68 ###########                    |
  0.7–0.8  n=24  predicted 0.74 ###############                |
                   observed  0.79 ##################             |
  0.8–0.9  n=15  predicted 0.84 ####################           |
                   observed  0.80 ##################             |
  0.9–1.0  n=20  predicted 0.94 ##########################     |
                   observed  0.80 ##################             |

Held out (5-fold cross-validation, constants refitted without the fold)
  0.5–0.6  n=30  predicted 0.55 ###                            |
                   observed  0.63 ########                       |
  0.6–0.7  n=33  predicted 0.65 #########                      |
                   observed  0.73 ##############                 |
  0.7–0.8  n=22  predicted 0.75 ###############                |
                   observed  0.73 ##############                 |
  0.8–0.9  n=18  predicted 0.84 #####################          |
                   observed  0.89 #######################        |
  0.9–1.0  n=17  predicted 0.95 ###########################    |
                   observed  0.77 ################               |
```

Shipped constants on all 120 series: Brier 0.197, log-loss 0.583 (the guessed constants of the
previous version: 0.199 / 0.628), mean predicted favourite win rate 0.716 against 0.742 observed,
expected calibration error 0.081 (held out: 0.078; the noise floor of the ECE with 120 series is
about 0.06–0.07, so this is at the floor, not below it). `test/quick-calibration.test.ts` asserts:
the likelihood is a distribution; the fitter recovers known constants from the simulator's own output;
the shipped constants are within 3 log-likelihood units of the optimum on the engine series (and ≥ 20
units better than rounds only); ECE < 0.10, |mean predicted − observed| < 0.05, Brier < 0.215; the
map round share matches the engine's within 0.04; a model fitted on half the series beats rounds only
by > 0.15 log-likelihood per held-out series.

**What is still wrong.** The top bin: series the model gives the favourite 90–100% were won 80% of
the time in-sample (77% held out; n = 20 and 17, i.e. about 2.5 standard errors from the prediction).
The two bins below it are fine. A saturating ability term did not explain it, so either it is chance
at this sample size or the engine has an upset mechanism the quick model does not (e.g. a floor on a
team's chance to lose a map). Also, the engine series date from before the latest engine changes (e.g.
`ecoSidearms` on by default): the constants describe that engine.

**Is 120 series enough?** For the noise terms almost: σ is pinned to ±0.05 already; τ needs about
190 series (**+70**, ≈ 5 minutes of engine time). The ability slope needs ≈ 1,100 series for ±5%
(+980, ≈ 70 minutes) and the map-pool slope ≈ 975 for ±0.1 — and it may simply be ≈ 0 (then drop the
term). The top bin needs ≈ 100 more favourites in the 90%+ range to say whether the overconfidence is
real: also ≈ 300–400 more series overall. These were NOT run (the lock belongs to the engine gates);
`tools/career/calibrate-quick-sim.mts --refit` (≈ 4 s per series) writes a new
`calibration-data.json`, then `fit-quick-sim.mts` refits in two minutes. Refit on the engine that
ships, ≈ 1,100 series, before relying on the quick estimate where it matters.

**Recommendation on the default depth (not a flip).** Keep `league` (engine for the manager's own
league) as the default for now. The quick estimate is now at the noise floor of calibration on
aggregate, but (1) the engine changed since the data were played, (2) the top-bin overconfidence is
unresolved, so it would make the manager's own league slightly too predictable for strong favourites,
and (3) the manager's league decides their qualification and standing, where a visible bias costs
trust; the price of keeping the engine is ≈ 8 minutes of waiting per season. `quick` is already the
right choice for the other regions and the international events. Make it the default for the own
league only after the 1,100-series refit passes the same bounds (and the top bin is flat).

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
