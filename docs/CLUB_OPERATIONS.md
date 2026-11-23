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
- The managed club is NRG (`DEFAULT_USER_TEAM`, Match Day's default team) until the shell's start menu picks one. `+1 day / +1 week / +1 month` run the local driver.
- Tests: `test/club-ops.test.ts` (in `test:unit`), `npm run test:e2e:club` (release a player, sign a free agent, see him in the wage list, set a training focus). The same step is in `test:e2e`.

## 7. Hooking into the career shell

`club/hooks.ts` defines `CareerHooks { onDay, onMonth, onSeasonEnd, postInbox }` and `registerClubOps(hooks)`. The shell's hook API was not on its branch when this was written, so this interface is the contract. `createLocalDriver` is a stand-in calendar for tests and the desktop buttons. The shell must:

1. after the user picks a club: `world = initClub(world, { userTeamId, date })`;
2. every day: run the onDay handlers with the new date; on the 1st, also the onMonth handlers (booking a month twice is a no-op);
3. at season end: run the onSeasonEnd handler with `{ standings }`. **It calls `advanceSeason` itself** (with the training focus), so the shell must not call it too. A shell that must call `advanceSeason` itself uses `clubBeforeSeasonEnd` → `advanceSeason(w, { focus: seasonFocus(w) })` → `clubAfterSeasonAdvance` instead;
4. show what `postInbox` receives (bilingual `{ko, en}` title/body and a `route`). The messages are also kept in `world.club.messages`.

The desktop's "Continue" button, the store's `advanceDays`, and the Scouting screen's season button (`advanceWorld` → `clubSeasonEnd`) are the places to swap for the shell's calendar.

## 8. Not done

- **The user's squad is still touched by the season loop.** `advanceSeason`'s squad step signs free agents for short rosters and releases beyond 8 for every club, including the user's (it acts like an assistant manager). The shell should skip the user's club there.
- **No fatigue/sharpness in matches.** Fatigue only scales training exposure; the match engine does not read it.
- **Match Day / Series do not yet read the world's rosters or practice records.** `practiceAdjustedRecords` and `startingFive` exist, but the series screen still uses dataset rosters and records.
- **No agents, sell-on clauses, signing bonuses, or performance bonuses.** There are no import limits beyond AI clubs shopping in their own region, and no international events or their prize money.
- **The board has no expectations beyond money** (no placement targets, no sacking).
- **Staff hiring and firing** stays automatic (the season loop fills vacancies). There is no staff market screen.
- **The full `test:e2e` currently fails before the club step** at the nav-debug block (pre-existing, see the regens handover), and with that block skipped, at the Review scoreboard. `test:e2e:club` runs the club step on its own and passes.
