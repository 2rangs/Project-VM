# Club operations: contracts, finance, transfers, training

Code: `packages/career/src/club/` (`@pv/career`, pure TS). Desktop: `apps/desktop/src/renderer/career/club.ts` and `screens/club/` (Finance, Transfers, Training, and the contract panel on the player detail).

Design rule: every number comes from a named formula over attributes, situation and decisions. There are no flat bonuses and no arbitrary probabilities. Every constant is in **`club/constants.ts` (`CLUB_MODEL`)**. Money is in US dollars per year. The constants are design values: there is no public data on esports wages, sponsorship or fees beyond press reports, and nothing here is a real contract.

State lives in `World.club` (`ClubState`, optional), so a save carries it and `advanceSeason`, which clones the world, keeps it. A world without `club` behaves exactly as before.

## 1. Ability index (shared by wages and values)

```
v(x) = clamp((x − caMin)/(caMax − caMin), 0, 1)                   calibration range of real players
w(t) = clamp((potentialAgeEnd − t)/(potentialAgeEnd − potentialAgeStart), 0, 1)     18 → 1, 25 → 0
e    = v(CA) + w(t) · share · (v(PA) − v(CA))                     share: wage 0.3, value 0.6
```

A club reads CA/PA through **its own scout's estimate** (`estimateAbility`), never the true values. A player judges his own role with his true CA (he knows his level). Team strength is public, so it uses true CA.

## 2. Contracts

`Contract { personId, kind, teamId, salary, startSeason, endSeason, buyout, squadRole, signedOn }`. A contract expires at the end of `endSeason`.

| | formula |
|---|---|
| market wage | `W = (wageFloor 30K + wageSpan 330K · e^2.2) · regionMarket` (Americas 1.1, EMEA 1.0, Pacific 0.85, China 0.8) |
| reputation | percentile of team strength S (mean CA of the top five) among all teams |
| club salary | `W · (1 + 0.3 · (reputation − 0.5))`: bigger clubs pay more |
| academy | flat 12K |
| real players' length | `1 + floor(u·3)` seasons, +1 at age ≤ 21, max 4 (u seeded per player) |
| buyout | `max(salary, 1.5 · value at signing)` |
| staff | `(floor[role] + span[role] · quality^1.5) · regionMarket`: coach 60K+160K, analyst 35K+70K, scout 30K+60K |
| severance on release | `0.5 · salary · seasons left` |

At `initClub`, every rostered and academy player and every employed staff member gets a contract. Free agents and new generated prospects are unsigned. After the season loop (`advanceSeason`) signs or releases players, `reconcileContracts` gives market contracts to its signings and academy promotions, and ends contracts of released and retired players.

**Expiry (season end).** An AI club re-signs a player when its scout ranks him in the club's top 6, he is under 32, the player's renewal utility (§4) is ≥ 0, and the wage fits the wage budget (a player counter within budget is accepted). Otherwise he becomes a free agent. On the user's club, any player not renewed beforehand (Contract panel → renewal offer) leaves, with a September notice and a season-end message. Staff contracts renew for 2 seasons at market wage.

## 3. Finance

| flow | formula | when |
|---|---|---|
| league stipend | 600K flat | 1/12 monthly |
| sponsorship | `S = 2.0M · market · (0.2 + 0.8 · fanbase) · (1 + 0.4 · (r − 0.5))` | set each season, 1/12 monthly |
| prize money | `500K · 0.75^(place − 1)` by regional placement | season end |
| fanbase | starts at `0.2 + 0.8 · reputation`; `f' = f + 0.3 · (r − f)` | season end |
| wages | player + staff contracts (loans split by wage share) | 1/12 monthly |
| operations | `250K + 0.1 · expected income` | 1/12 monthly |
| reinvestment | `0.6 · (balance − 1 · annual costs)` per year when above that reserve | 1/12 monthly |
| owner support | balance below `−0.25 · expected income` → topped up to 0 | monthly |
| transfer fees, severance | as they happen | |

`r` = result score `1 − (place − 1)/(n − 1)`. Placement comes from the season loop's standings (`SeasonEndContext.standings`, teamId → place in its region). Without standings, it is the strength order plus N(0, 0.02) noise, seeded by season and team.

**Board (season start):** expected income = stipend + S + the prize of the expected placement (strength order). Wage budget = `0.6 · expected income`. Transfer budget = `0.5 · max(0, balance − 0.25 · annual costs)`. In the first season only, the wage budget is raised to cover the payroll the club starts with. A sale adds `0.5 · fee` to the seller's transfer budget. Starting balance = `0.5 · annual costs`. The board posts a message when the wage bill is more than 5% over budget or the balance is negative (once a month at most), and when the owner has to cover debt.

The two sinks/floors (reinvestment above the reserve, owner support below the debt limit) are what keep clubs bounded. Over 3–5 seeded seasons the median balance settles around $1.5–1.8M, the richest club around $3.5–4M, and nobody passes the debt floor (`club.test.ts`).

## 4. Transfers, loans, free agency, renewals

**Windows** (`CLUB_MODEL.windows`): pre-season 01-01…02-15 and mid-season 06-01…06-30. Transfers and loans need an open window. Free agents and renewals don't.

**Player value**: `V = 2.0M · e^2.5 · A(age) · K(yearsLeft)`, where `A = 0.88^max(0, age − 25)`, `K = clamp(0.3 + 0.7 · yearsLeft/2, 0.3, 1)` and yearsLeft = endSeason − season. Free agents carry no fee.

**Selling club**:
```
asking = V_seller · (1 + 0.35·[starter] + 0.5·[would drop below five])
fee ≥ buyout → must accept;  fee ≥ asking → accept;  fee ≥ 0.6·asking → counter at asking;  else reject
loan: a starter is never loaned; borrower must pay ≥ 50% of the wage (else counter at 50%)
```

**Player**:
```
U = 1.0·ln(wage/ref) + 1.2·ambition·(S_to − S_from) + 0.6·(R_to − R_from) + 0.15·L
ref = max(current salary, 0.8·market wage)    (free agent: 0.7·market wage)
R   = expected role: starter (top five by true CA at that club) 1, rotation 0.35, academy 0.1, no club 0
L   = −|years − L*|/3,  L* = clamp(1 + (age − 20)/4, 1, 3)
ambition ∈ [0.2, 1], hidden, seeded per player
U ≥ 0 → accept; else counter with the wage giving U = 0.02 if ≤ 2× the offer; else reject
renewal: ambition and role terms are 0;  loan: U = 0.6·ΔR + 0.6·ambition·ΔS (wage stays with the parent club)
```

Flow (`makeOffer`): validation (`windowClosed`, `squadFull` (8), `overBudget`, `pendingExists`, `releasedHere`: no re-signing a player you released this season) → club stage → player stage → completion. Completion books the fee to both ledgers, writes a new contract (buyout from the buyer's valuation), moves the player onto the roster and voids his other offers. A counter waits for the buyer (`answerCounter`). A bid for one of the user's players waits for the user (`answerIncoming`, expires after 7 days); if accepted, the player then decides.

**AI market** (weekly on Mondays in a window, `aiMarketRound`): each AI club takes its turn in a date-rotated order, at most 2 buys per window. A club over its wage budget first releases the bench player with the highest salary per estimated CA. Then it targets the player in its own region (other rosters + free agents) whose scout-estimated CA is highest and at least 0.03 above its weakest starter, and who fits its budgets (fee = own value × 1.1, wage = its club salary). Counters within budget are accepted. A full roster releases its weakest player first. AI clubs also bid for the user's players.

## 5. Training

Plan per team: weekly team focus `balanced | mechanics | utility | teamplay | tactics | rest`, the map for tactics weeks, and an individual focus per player (`balanced | mechanics | utility | teamplay`). Groups: mechanics → aim, crosshairPlacement, firstBulletAccuracy, reaction, tracking; utility → impact (gameSense / decisionMaking in the engine; `utilityUsage` itself is unrated); teamplay → trading, consistency.

Weekly tick (Mondays, only for teams with a plan):
```
exposure_g += (0.7·team_g + 0.3·indiv_g) · (1 − 0.5·max(0, fatigue − 0.3))     (rest week: no individual work)
fatigue' = clamp(fatigue + load − 0.08)   load: training 0.12, tactics 0.10;  rest: fatigue − 0.35
tactics week on map m: each starter's practice games on m += 6 scrims · 0.25 = 1.5
```

**Development** (season end, `advanceSeason(world, { focus: seasonFocus(world) })`): `F_k = (1 − 0.45) + 0.45 · 3 · x_g(k)`, where x_g is the mean weekly exposure. It multiplies the existing growth term: `x' = x + clamp(r(t)·P·C·F·(1+σz), 0, 1)·(peak − x) − decline`. Balanced training under the fatigue threshold gives F = 1 exactly, and a team without a plan (every AI club) develops exactly as before (tested byte-for-byte). A fully used week has Σx = 1, so the mean F over the groups stays 1: focus moves growth between groups rather than adding any. Tactics and rest weeks, and fatigue, lower Σx. Decline, peaks and caps are untouched.

**Map mastery** (M = 0.5H + 0.3C + 0.2F, `docs/SERIES_AND_VETO.md`): `practiceAdjustedRecords(world, teamId, records)` adds the practice games to `playerGames`, which the continuity component C reads. Pass the result as `MasteryRequest.records`. H (official results) and the comp fit are untouched. Practice carries 50% into the next season. A map record whose playerGames are allocated (null in the data) is left as it is.

## 6. Desktop

- **Finance**: balance, wage bill vs budget (bar), transfer budget, sponsorship and fanbase, season flows, ledger, wage list (opens the contract panel), board messages.
- **Transfers**: window status, budgets, search (role, max age, min scouted CA, max value, free agents only, all regions), shortlist, our offers (accept counter / withdraw), incoming bids (accept / reject). CA/PA are always the user scout's ranges.
- **Training**: team focus, practice map, per-player focus, fatigue, this season's growth factors.
- **Contract panel** (player detail on Squad/Transfers/Finance/Training): contract, value estimate, shortlist, offer form (transfer / loan / free / renewal) with the player's utility breakdown, release.
- The managed club is the career's (start menu → new career). The club screens exist only inside a career; time moves only with **Continue** on Home (the club's own +day/week/month buttons are gone). Club actions change the career's world and autosave; the club's messages are career-inbox items (source `club`), and the Finance "board" tab lists them.
- Tests: `test/club-ops.test.ts` (`test:unit`, through a real career), `packages/career/test/club.test.ts`, `npm run test:e2e:club` (start a career, release a player, sign a free agent, see them in the wage list, set a training focus) and `npm run test:e2e:career` (the whole loop, below).

## 7. Inside the career shell

The club layer is built into career mode: `club/career-hook.ts` exports `clubCareerHook`, which `career/career.ts` runs right after the core hook (order 10) on every career. The club's own `CareerHooks` interface and local driver are gone. What it does on the career's calendar (docs/CAREER_MODE.md §6 is the hook API):

1. `onCareerStart`: `initClub(world, { userTeamId: <the manager's club>, date })`;
2. `onDay`: `clubOnDayMut` for the day that begins (windows, expiring bids; Mondays the training tick and, in a window, an AI market round); `onMonth`: `clubOnMonthMut` (the ledger, board checks, the July "contracts expiring" notice);
3. `onSeasonEnd`: `clubBeforeSeasonEndMut` with `careerStandings` (the manager's region from the league's two stage placings, other regions by strength with the seeded placement noise): loans return, prize money, fanbase, contracts expire or are renewed. Then the career runs `advanceSeason(world, { mapsPlayed, focus: seasonFocus(world), managedTeams: [the manager's club] })`;
4. `onSeasonStart`: `clubAfterSeasonAdvanceMut` (contracts for the season loop's signings, the new budgets, the training reset);
5. inbox: every club message is queued in `club.outbox` as a career inbox draft (ko/en `text`) and drained after each step; a bid for one of our players is an inbox item with accept / reject and is closed when it is answered in Transfers or lapses (`syncClubInbox`).

One package-wide definition each: `InboxItem` (career/inbox.ts), the date helpers (career/calendar.ts; `club/calendar.ts` keeps only the window calendar and the season dates), `teamStrength` (club/market.ts, re-exported by career/schedule.ts). The calendar is career mode's: the season runs 5 January – 1 September, windows are pre-season (1 Jan – 15 Feb), mid-season (June) and the off-season (2 Sep – 31 Dec).

**The season loop leaves the manager's squad alone.** `advanceSeason`'s `managedTeams` skips academy picks and releases, promotions, free-agent signings and roster-cap releases for those clubs; only the manager and club-ops transfers change the squad (retirement still applies). A manager whose contracts expire below five players must sign players: the lineup screen needs five.

## 7a. Matches read the club (docs/CAREER_MODE.md §4)

- **Lineup:** the manager picks the five from the squad (roster + academy) before each match (`setLineup`, `lineupFor`); the choice is kept.
- **Fatigue → match form, by formula.** Match readiness `R = (1 − 0.25·max(0, f − 0.3)) · (1 − 0.08·(1 − s))` with `f` the training fatigue above plus match load (0.03 per map played) and `s` the match sharpness (each map: `s ← s + 0.2·(1 − s)`; fades `exp(−days/30)`; 0.6 before a player has played). For the match each ability attribute becomes `x' = floor + R·(x − floor)` (floor = the calibration minimum): a tired or rusty player plays below their rating in proportion to how good they are; nothing is added. The engine's rosters and the quick estimate both read `x'`.
- **Map practice → map mastery:** the team's `mapPractice` is added to game-data's map records (`withPractice`) and passed as the series team's `mapRecords`, so the continuity component C of mastery reads it, in the manager's series and in the background simulation.
- **Playing time → development:** the maps each player actually played (K/D too, from the engine) go to `advanceSeason({ mapsPlayed })`.

## 7b. The career e2e

`npm run test:e2e:career`: start menu → new career → the board's question → a free agent signed on a one-year contract → training focus and practice map → Continue to the first match day → a lineup that includes the signing → the series through the engine → recorded (standings, minutes, kills/deaths) → other teams' series through the engine in the background → the season played out → the contract expires at the season end, the season loop adds nobody to the squad → Continue from the main menu reproduces the save.

## 8. Not done

- **Short squads:** nothing refills the manager's squad after contracts expire; below five players the lineup screen cannot be confirmed (the manager must sign someone, the Home screen does not warn yet).
- **Fatigue and morale are single numbers per player.** There are no injuries, so the physio only speeds fatigue recovery.
- **The sack is a flag.** `club.board.sacked` is set, the inbox and the Board screen say so, and the board stops taking requests. Career mode does not yet end the career or offer another job.
- **AI clubs have no board, morale, bonuses or agent fees** (they stay neutral: morale 0.5, no bonuses). Only the manager's club carries them. AI transfers still pay the agent fee (it is on every signing).
- **No import limits** beyond AI clubs shopping in their own region. No international events or their prize money: "international qualification" is judged as finishing within the region's top `internationalSlots`.
- **Staff vacancies at AI clubs** are still filled by the season loop at season start (no mid-season AI staff market).
- **Scouted attribute ranges:** the scout's error is the CA/PA band (`estimateAbility`). If per-attribute ranges arrive (generated-players session), they should read the same scout attributes (`judgingAbility`, `judgingPotential`), so the staff market feeds them without changes. A proposal is in the shared notes (`scouting-interface.md`).
- **The full `test:e2e`** fails at the nav-debug block (pre-existing, see the regens handover); `test:e2e:club` and `test:e2e:career` cover the club screens.

## 9. Agents, bonuses, clauses, renewals, free-agent timing

Constants: `DEPTH_MODEL` in `club/constants.ts`. Code: `club/people.ts`, `club/transfers.ts`.

| | formula |
|---|---|
| agent | hardness `h ∈ [0,1]`, seeded per player |
| agent fee | `(0.03 + 0.07·h) · wage · years`, paid by the signing club at signing (every signing, AI included) |
| player's margin | accepts at `U ≥ acceptMargin + 0.15·h`; a counter asks the wage that brings U to that margin |
| bonuses in the utility | `W_eff = wage + 0.8 · (signing/years + loyalty/years + perWin · E[wins] + perTitle · P(title))`, with `E[wins] = 12 · σ(6·(S_to − 0.5))` and `P(title) = σ(10·(S_to − 0.8))`. The wage term is `ln(W_eff / ref)` |
| bonus costs | signing at signing; perWin after each series won where the player played; perTitle when the club wins its region; loyalty when the contract runs to its end at the club |
| release clause | the player's utility `+ 0.15 · ambition · clamp((default − asked)/default, −1, 1)`. A fee ≥ the clause must be accepted (§4) |
| sell-on | the selling club counts `fee + sellOn · 0.5 · its value of the player` against its asking price (max 30 %). On the next sale, `pct · fee` goes to the old club |
| renewal feelings | `+ 0.3 · 2(m − 0.5) + 0.4 · (share − expected share) + 1.2 · ambition · (S_club − v(CA)) · 0.6` |
| renewal refusal | when those non-wage terms are below −0.45, the player refuses whatever the wage |
| free-agent timing | a free agent's reference wage `× max(0.6, 1 − 0.06 · months unsigned)` |

The expected playing-time share by role is starter 0.9, rotation 0.3, academy 0.05. Shares come from maps actually played this season (`club.playTime`, filled after every series in the league).

## 10. Morale and condition in the match

**Morale: one model** (`development.ts` `moraleOf(world, player, form)`). Every reader uses it: development at season end, renewals, the match roster (when the flag is on), and the Scouting, Training and offer screens.

- **Derived** (any player no club tracks, which means every AI club's): the generated-players formula
  `m = clamp(0.5 + s·(0.6·(form − 0.5) + 0.5·(R − R*)), 0, 1)`, where
  - `R` = role now (starter 1, rotation 0.35, academy 0.1, no club 0),
  - `R* = 0.35 + 0.65·ambition`,
  - `s = 1.2 − 0.4·temperament`.

  The player is taken to sit at his equilibrium. Development for these players is exactly what it was before the unification.
- **Tracked** (the manager's squad, `club.morale[playerId]`): the state.
  - It starts from the derived value (no stored entry → derived).
  - Weekly: `m ← m + 0.3·(T − m)`, with `T = clamp(derived(form, role) + 0.3·(r5 − 0.5) + 0.2·clamp(ln(salary/market), −0.5, 0.5) + 0.2·(coach.motivation − 0.5), 0, 1)`. Here `r5` is the club's share of its last five series won, and `form` is the career's per-player form (0.5 par).
  - With average results, pay at market and an average coach, `T` is the derived value, so tracking only adds what the club does.
  - After a series, the five who played move ±0.03.
- **Development** reads `moraleOf` at season end, through the morale factor `Mor = 0.9 + 0.2·m` (GENERATED_PEOPLE.md §10). Each season's value is recorded in `WorldPlayer.history`.
- **Saves:** a save without `club.morale` (or without a player's entry) reads the derived value; stored entries are kept as they are. The playing-time share is no longer a term of `T` (role vs. ambition covers it), but it still enters renewals (§9).

**Into the match — behind `CLUB_FLAGS.moraleInMatch`, default OFF** (career/readiness.ts `matchAttributes`, the roster the engine and the quick sim read; `setClubFlags({ moraleInMatch: true })` turns it on):
- Readiness (fatigue, sharpness) scales the ability attributes toward the floor, as before.
- Then morale, with `d = m − 0.5`, scales the same span by `(1 + 0.1·d)` (capped at the real maximum) and moves `consistency ± 0.2·d` and `clutch ± 0.2·d`.
- In match-runner (teams.ts, unchanged) consistency feeds the decision profile's `discipline` and the round-form σ. Clutch feeds `decisionMaking` (mean of impact and clutch) and the pressure form.
- Fatigue reaches decisions the same way, through the readiness-scaled `consistency` and `impact`.
- No match-runner or round-simulator file changed, and the default engine path (no career roster) is untouched. At neutral morale the roster is byte-identical (tested).

**Measured** (`test/morale-match.test.ts`, opt-in `PV_MORALE_MATCH=1`, run through heavy-run.sh): the same five against the same opponent on the same 16 seeds, morale 1 vs 0.5 vs 0. Rounds won by the five:

| run | high morale | neutral | low morale | rounds played |
|---|---|---|---|---|
| decision terms only, N = 16 | 142 | 145 | 151 | 340 |
| with the level term, N = 30 | 281 | 279 | 281 | 628 |

Neither run shows a measurable effect: the spread is within paired-seed noise. That is why the flag stays off. Next step: check how strongly the engine responds to roster ability at all (a probe with every ability attribute at the floor was queued and cancelled at wrap-up), then size `moraleAbility` from that response.

## 11. Board

Code: `club/board.ts`. Board state lives in `club.board` (the manager's club only).

- **Objectives (season start).** The expected place is the club's strength rank in its region (stature). The target is that place, one better when the club's wage + transfer budget is above its region's median. "International" is set when the target is within the top 3. The wage objective always applies.
- **Confidence** starts at 0.6 and moves:
  - After each of the manager's series: `+0.03 · (result − σ(6·(S_us − S_them)))`.
  - Monthly: `+0.02 · score`, where score is +1 when clean, −1 for each breach (wage bill over budget, balance negative).
  - At season end: league `±0.2 · clamp((target − place)/2 ± 0.5, −1, 1)`, international ±0.1, wages ±0.05.
- **Warning and sack.** A warning comes once below 35 %. Below 15 % the manager is sacked (§8).
- **Requests** (one of each kind per season, granted at confidence ≥ 0.5 / 0.55 / 0.5 / 0.45; granting costs 0.03 confidence):
  - Transfer budget: `+min(0.25 · expected income, ½ · cash above the reserve)`.
  - Wage budget: up to +10 %, capped at 0.7 · expected income.
  - Facilities: +0.1 for $400K, if cash stays above the reserve.
  - Staff budget: +$60K of wage budget.
- **Facilities** (0..1, neutral 0.5) feed the development formula's coach factor input: `development + 0.5·(facilities − 0.5)` (season.ts `coachDevelopment`). A club without a facilities entry develops exactly as before.

## 12. Staff market

Code: `club/staff-market.ts`. Roles: head coach (development, motivation), analyst (analysis), scout (judging ability and potential), and a new physio (physiotherapy). Every team gets a physio from the season loop.

| staff | feeds (existing formula) |
|---|---|
| headCoach.development | coach factor C of the development formula (+ facilities) |
| headCoach.motivation | the morale target `T` (§10) |
| analyst.analysis | the series analyst: opponent games reviewed, mastery-estimate error (match-runner via `teamStaffInputs`) |
| scout.judging* | σ of every CA/PA estimate the club sees (`scouting.ts`); a better scout narrows the bands (tested) |
| physio.physiotherapy | weekly fatigue recovery `× (0.75 + 0.5·p)`, rest weeks too; 1 with no physio |

- **Demand:** `staffWage · (1 + 0.3 · (quality − club reputation))`, so a good coach asks a small club for more.
- **Hiring:** at ≥ the demand, for 2 seasons, within the wage budget. It replaces the holder of the post, who gets severance and joins the pool.
- **Dismissal:** pays severance on the rest of the contract.

Desktop: **Board** screen (confidence, objectives, review, requests, history, sack banner), **Staff** screen (role tabs, market table, hire/dismiss in the detail panel), a **morale** column in Training, and **bonuses & clauses** plus the agent's hardness and fee in the offer form.
