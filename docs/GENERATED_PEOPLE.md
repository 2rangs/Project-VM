# Generated people (regens) and the season loop

Package: `packages/career` (`@pv/career`). It is pure TypeScript with no Node APIs, so the desktop renderer runs the same code. `@pv/career/game-data` builds the starting world from `@pv/game-data` under Node.

Generated people are fictional players and staff who do not exist. They enter the world each season, as regens do in Football Manager. Every one of them carries `origin: "generated"` and `generated: true`. Real players from the dataset carry `origin: "real"`.

## 1. Data model

`WorldPlayer` is a superset of game-data's `Player` (`playerId, handle, country, role, attributes, hasRatings`), so anything that takes a game-data player also takes a generated one. It adds:

- `name`: the person's name (generated people only; the dataset has handles, not names)
- `region`, `agentPool`, `age` and `ageEstimated`
- `peak`: the hidden per-attribute values the player is heading for
- `ca` and `pa`: current and potential ability
- `teamId` and `status` (`rostered | academy | free`)
- `careerMaps`, plus `origin`, `generated` and `debutSeason`

The attributes use the dataset's own shape: `{ value, uncertainty, nMaps }` for the ten rated attributes, and `{ value: null, reason }` for the twelve attributes the dataset cannot estimate. The engine therefore reads generated and real players the same way, and both fall back to league average for `movement`, `weaponControl` and the other unrated attributes.

**CA and PA** are the equal-weight mean of the eight *ability* attributes: aim, crosshairPlacement, firstBulletAccuracy, reaction, tracking, impact, trading and consistency. CA uses the current values and PA uses `peak`. `entryAggression` is a tendency, not a quality, and `clutch` has no spread in the data (every rated player is 0.6), so neither counts toward CA/PA and neither develops. The UI shows CA/PA on a 1–200 scale: `round(1 + 199·v)`.

`WorldStaff` has the roles `headCoach`, `analyst` and `scout`. Each role has only the attributes something reads:

| attribute | read by |
|---|---|
| `headCoach.development` | development rate of the team's players (coach factor C, §3) |
| `analyst.analysis` | match-runner series `staff.analyst`, via `teamStaffInputs(world, teamId)`: games reviewed and the error of the opponent-mastery estimate |
| `scout.judgingAbility` | error of the CA estimate shown for a player (§5) |
| `scout.judgingPotential` | error of the PA estimate, and so which prospects an academy picks |

The dataset has no staff, so every staff member, including the founding staff of each real team, is generated.

## 2. Generating a player

**Calibration.** `deriveCalibration(realPlayers)` computes the following from the dataset's 402 rated players at world creation, and the result is stored in the world so a loaded save generates identically:

- per role and per attribute: the mean μ and standard deviation σ
- per attribute: the real minimum and maximum
- the role CA means and the real CA range (0.381–0.793)
- the role shares and the country counts per region
- how often each agent appears in each role's agent pools

**Draws.** All draws come from `mulberry32(deriveSeed(worldSeed, "gen-player:" + id))`. One person never shifts another's draws, and the same seed and id always produce the same person.

| step | formula |
|---|---|
| region → country | weighted by the real players' countries in that region (47 kr vs 6 sg in Pacific, …) |
| role | weighted by real role shares |
| age | 16 / 17 / 18 / 19 with weights 0.2 / 0.3 / 0.3 / 0.2 |
| talent | `PA* = caMin + (caMax − caMin) · u^1.6`. This is skewed low: most prospects never reach the elite |
| peak (archetype × talent × individual) | `peak_k = μ_role,k + (PA* − CA̅_role) + 0.6 · σ_role,k · z_k`, shifted so `mean(peak) = PA*`, then clamped to the real `[min_k, max_k]` |
| current (age curve with noise) | `x_k = min_k + m_k(age) · (1 + 0.1·z'_k) · (peak_k − min_k)` |
| tendencies | `entryAggression = μ_role + σ_role·z`, inside the real range; `clutch = 0.6` |
| agent pool | 1–4 agents, drawn without replacement, weighted by how often the role plays each agent |
| uncertainty | `U = 0.10 · sqrt(10 / (10 + careerMaps))`; real players' median is about 0.05 |

Because `x_k ≤ peak_k` for every attribute, **CA ≤ PA always holds**. Every value stays inside the range the real players have.

**Maturity curve.** `m(t) = clamp((t − 14) / (25 − 14), 0, 1)^0.8`. Mechanical attributes run 1.5 years ahead of this curve; impact, trading and consistency run 1.5 years behind it.

**Real players' age and potential.** The dataset has no ages. A player's age is estimated as `19 + (2026 − first dataset season)`. Players already present in 2021 (the dataset's first season) are left-censored and get 0–3 extra years. Players with no season record are 21–24. Real players' potential comes from inverting the age curve: `peak = min + (x − min) / m(age)`, clamped to the real maximum. A 25-year-old has `peak = x`.

**Names.** Each name culture (16 of them) has a pool of generic given-name and family-name parts. Korean and Chinese given names are built from two syllables, and East Asian names put the family name first. Handles are assembled from invented syllables in one of four styles (Capitalised, lower, UPPER, digit tail). A handle is rejected and redrawn when, after lowercasing and stripping punctuation, it:

- matches any real player's handle in the dataset (all 1 227 handles in game-data; the desktop ships them as `reserved_handles.json`)
- matches a handle already issued in the world
- is shorter than 3 characters
- contains a blocked rude fragment

## 3. Development, decline and retirement (per season, age t → t+1)

```
x' = clamp( x + clamp(r(t)·P·C·(1 + 0.25·z), 0, 1) · (peak − x) − λ·max(0, t + 1 − D),  min, peak )
r(t) = (m(t+1) − m(t)) / (1 − m(t))           closing rate: following it reproduces the maturity curve
P    = 0.5 + 0.5 · min(1, maps / 40)           playing time; maps: starter 40, bench 10, academy 20, free 4
C    = 0.75 + 0.5 · coach.development          no coach → development 0 → C = 0.75; average coach → 1
λ    = 0.006, D = 26 (mechanical) / 30 (others)
```

A season with playing time also widens the agent pool, up to `3 + careerMaps/80` agents (at most 10).

**Retirement hazard.** `h(t) = 1 / (1 + exp(−(t − A50) / 1.5))`, where A50 depends on the player's situation:

- signed players (main roster): A50 = 31
- unsigned players (free agents or academy): A50 = 22 + 9·v, where `v = (CA − caMin) / (caMax − caMin)`. A weak player nobody signs quits early.

**Staff.** Staff gain `(0.95 − x)·0.05` per season until age 45 and lose `0.004·(t + 1 − 58)` after 58. Their retirement A50 is 62 when employed and `38 + 22·quality` when not.

## 4. Season flow: `advanceSeason(world) → world`

The function is pure: it returns a new world and leaves the input unchanged. It is also deterministic.

1. **Development and decline** of everyone, based on the season just played (playing time by status, the team's head coach).
2. **Aging**: everyone gets one year older.
3. **Retirement** by the hazard above. Retired people leave the world and a short `retired[]` record is kept.
4. **Staff**: new generated staff top the pool back up to its target (`teams · 3 roles · 1.5`). Each vacancy is filled by the best free staff member of that role, own region first.
5. **Intake**: new prospects per region, `n_r = max(ceil(0.03 · T_r), T_r − N_r)`. T_r is the region's target population (its size at world creation) and N_r its size after retirements. This keeps each region's population at its target.
6. **Academies**: up to 3 places per team; a player who passes age 21 without promotion is released. Teams pick in a season-rotating order, and each takes the new prospect from its own region that its scout rates highest for PA.
7. **Squads**:
   - Rosters are re-sorted by CA, and the first five start.
   - An academy player is promoted when the scout rates them above the weakest starter, or when the roster has fewer than five.
   - A roster below five signs the free agent the scout rates highest for CA, own region first.
   - Rosters over 8 release their weakest player.

Each season leaves a `SeasonRecord` in `world.history`: new players and staff, retirements, signings, academy picks, releases, hires, and the population by region.

**Measured** (seed 7, game-data world of 1 227 players, 70 teams, 15 seasons):

- Region populations stay exactly on target.
- Staff stays at 315.
- Intake and retirement run at about 170–220 a year (about 16% turnover).
- The starting fives' mean CA stays between 0.634 and 0.669 (it starts at 0.634).
- Generated players hold most roster places after about 10 seasons.

## 5. Scouting estimates

```
σ_CA = (0.01 + 0.08 · (1 − judgingAbility)) · sqrt(10 / (10 + careerMaps))
σ_PA =  0.02 + 0.15 · (1 − judgingPotential)
estimate = true + σ·z,   z ~ N(0,1) clamped to ±2, fixed per (scout, player);   band = ±σ
```

AI teams pick academy prospects and sign free agents using these estimates, so a team with a better scout signs better players.

## 6. Playing a match with generated players

`MatchConfig.rosters?: { A?: RosterPlayer[]; B?: RosterPlayer[] }` was added to match-runner. When it is set, the match fields those players (the first five) instead of the team's game-data roster. Skills, traits, decision profile, consistency and throw floors are read exactly as for game-data players. When it is omitted, the match is byte-identical to before (tested in `match-runner/test/rosters.test.ts`).

`startingFive(world, teamId)` returns a world team's five. `packages/career/test/match.test.ts` plays a full match with a generated starter.

## 7. Save and load

`serializeWorld(world)` produces JSON tagged `{ format: "pv-career-world", world }`, and `deserializeWorld(text)` checks the tag and version and restores it. A loaded world continues byte-identically (tested). The desktop keeps its world in `localStorage` (`pv-career-world-v1`), saving after every change.

## 8. Desktop

- **Scouting** (left nav, CLUB): the season, the population, an "Advance season" button and a "Reset world" button. It has three tabs:
  - this season's new prospects
  - free agents
  - staff

  Every generated person carries a GEN / 생성 tag. Rows open the player or staff detail (CA/PA as scout ranges; staff attributes with what each one drives).
- **Squad**: now lists the world's players, real and generated, with an age column. The detail panel shows the name, age (marked as estimated for real players), club or academy, and CA/PA.
- ko/en strings are under `career.*`.

## 9. Scouting knowledge: the attribute fog (`knowledge.ts`)

In a career the manager never sees the true attributes of a player outside their own club. Every such player is shown as ranges, and the width of each range comes from the club's **knowledge** κ ∈ [0, 1] of that player. The match engine is untouched and still reads the true attributes. AI clubs keep the scout-error model of §5; `estimateForTeam` routes only the manager's club through the fog, so AI decisions are unchanged (tested). Every constant is in `KNOWLEDGE_MODEL`.

**Where knowledge comes from**

| source | formula |
|---|---|
| reputation (the floor) | `κ0 = 0.05 + 0.45 · min(1, public maps / 150)`. Public maps are the dataset sample plus the maps played in this world |
| time | `κ ← κ0 + (κ − κ0) · exp(−Δdays / 120)`: unrefreshed knowledge fades back to the floor |
| scout assignment (each Monday) | `Δκ = G · e · q · (1 − κ)`. G: player 0.30, region 0.04, our league 0.08, youth 0.10. e is the player's exposure: rostered 1, academy 0.6, free 0.4. q is the scout's gain (below) |
| our league, passively | `Δκ = 0.01 · (1 − κ)` a week for every player of the league's teams |
| matches played | per map, against or with the player: `Δκ = 0.06 · q_best · (1 − κ)` |
| youth trial (season start) | the region's new prospects: `Δκ = 0.25 · q_best · (1 − κ)` |

**What κ does to the view**

| | half-width h (attribute units, 0..1) |
|---|---|
| each attribute | `h = 0.01 + 0.16 · (1 − κ) · (1 − 0.5 · judgingAbility_best)` |
| CA | the mean of the attribute half-widths (CA is the mean of the attributes) |
| PA | `0.01 + (0.12 · (1 − κ) + 0.06 · youth(age)) · (1 − 0.6 · judgingPotential_best)`, with youth(age) = 1 at 16 and 0 at 25 |
| own players | `0.005 + 0.03 · (1 − head coach development)`: the coaching staff's read |

The estimate is `true + h · z/2`, with z ~ N(0,1) clamped to ±2 and fixed per (club, player, attribute). The shown range `[est − h, est + h]` therefore always contains the true value (tested for 300 players). PA is never shown below CA.

**Assignments and reports.** Each scout has one assignment: a player, a region, our league, or a region's youth (≤ 19, not on a main roster). Scouts start on the club's region.
- A player assignment writes a report every Monday.
- The wider assignments each write up to three reports a week, on the most promising players they covered (by our PA estimate). A player qualifies when known to at least 0.2 and not reported in the last 56 days.

A report holds the date, the scout, κ, the CA and PA ranges, and a recommendation:
- **sign**: the CA estimate (or, for 21 and under, the PA estimate) beats our weakest starter by 0.02
- **monitor**: the PA range's top reaches our weakest starter
- **pass**: otherwise

The inbox gets a summary when a report concerns an assigned player or recommends signing, and a youth-trial message at each season start.

**Interface for the staff market (club operations).** A scout is any `WorldStaff` with `role: "scout"` and `teamId` set to the club (`clubScouts`; the team's `staff.scout` post counts too).
- In: `attributes.judgingAbility` and `attributes.judgingPotential` (0..1).
- Out: `scoutGain(scout) = 0.5 + 0.5 · judgingAbility` (the knowledge gain factor q), plus the accuracy terms above, which use the club's best values.

Hiring a second scout gives the club a second assignment. A club with no scout learns at q = 0.3.

**Per-attribute ranges `{ value, lo, hi }` for club screens.**
- `estimateAttributes(world, scout, p)` (scouting.ts) gives the scout-error model per attribute. Its half-width is the CA σ of §5, its estimate is `true + σ·z/2`, and its range holds the truth.
- `attributeRangesForTeam(world, teamId, p)` returns the fog for the manager's club and `estimateAttributes` for any other club.

## 10. Development drivers (`development.ts`)

The growth term of §3 gains a multiplier D, and the decline term gains its own multiplier:

```
x' = x + clamp(r(t)·P·C·F·D·(1 + σz), 0, 1)·(peak − x) − λ·max(0, t+1−D_k) · (1.2 − 0.4·professionalism)
D    = Pers · Mor · Ment
Pers = 0.8 + 0.4 · professionalism                     (0.5 → 1)
Mor  = 0.9 + 0.2 · morale                              (0.5 → 1)
Ment = 1 + 0.2 · leadership(mentor) · fit              fit 1 same role, 0.5 otherwise
morale = clamp(0.5 + s · (0.6·(form − 0.5) + 0.5·(R − R*)), 0, 1)
  R  = role now: starter 1, rotation 0.35, academy 0.1, no club 0      R* = 0.35 + 0.65 · ambition
  s  = 1.2 − 0.4 · temperament                                         form = the career's per-map form (0.5 par)
leadership(t) = leadership₀ · (0.4 + 0.6 · clamp((t − 17)/13, 0, 1))   grows late, full at 30
```

- **Personality.** Professionalism, temperament and leadership₀ are uniform 0..1, fixed per player (seeded). Ambition is the club layer's hidden value (`ambitionOf`).
- **Mentors.** Set by the manager (`setMentorMut`). A mentee is 23 or under; a mentor is 24 or over, at the same club, and at least as good.
- **Attribute groups.** The age curves already differ by group: mechanics mature 1.5 years early and decline from 26, while game sense, trading and consistency mature 1.5 years late and decline from 30. Leadership is the latest group and grows to 30.
- **History.** Each season `advanceSeason` records a point per rated player (season, age, CA, maps, morale) in `WorldPlayer.history`, keeping at most 12.

**Measured** (`test/development.test.ts`: seed 77, 15 seasons, the 1 227-player game-data world):
- Mean CA change per season: +0.011 to +0.018 from 16 to 23, about 0 at 26, then −0.007 at 27, −0.011 at 28 and −0.015 at 29 (accelerating).
- Aim stops growing at 24 and declines from 26; game sense still grows at 24–25 and declines only from 30.
- 81% of generated 25–27-year-olds are within 0.03 of their PA (not all: minutes, coach, personality).
- Retirement age median: 30 for signed players, 25 overall (unsigned players quit early). Nobody plays past 40.

## 11. The manager's academy (`academy.ts`)

The season loop leaves the manager's squad to the manager (`managedTeams`), so the academy is in the manager's hands:

- **Invite**: a free agent aged 21 or under joins on the academy wage, for `min(3, 22 − age)` seasons. It is reached from the player page; the youth trial and the youth assignment are how the manager finds prospects.
- **Promote** to the main roster (up to 8), or **send back** to the academy (21 and under; 3 places).
- **Release**: the club layer's release, with severance.
- **Loan out** (open window): the borrower takes the player when its own scout rates them no more than 0.03 below its weakest starter (or it is short of five). The player accepts by the club layer's loan utility (more minutes), and the borrower pays half the wage. An academy loanee returns to the academy at the season's end (`Loan.returnTo`).

## 12. Desktop (career)

- **Scouting** has four career tabs before the existing ones:
  - Scout reports: date, player, age, role, CA/PA ranges, knowledge, advice
  - Assignments: per scout, the judging ratings, the current assignment and a new one (region / our league / youth of a region / a shortlisted player)
  - Shortlist: the club layer's shortlist with ranges, knowledge and the latest advice
  - Squad & academy: CA/PA, morale, last season's change, mentor
- **The player page** in a career:
  - Ranges for every rated attribute (band and best-estimate tick) and for CA/PA, plus a knowledge badge.
  - The latest scout report and "scout this player".
  - For our own players: morale, personality in words, the mentor picker, and invite / promote / send down / loan-out buttons.
  - A development chart: CA per season for our players, or the CA ranges of past reports for others.
- **The Squad list** in a career shows aim and game sense as ranges, plus a knowledge column. Transfers, Home and lineup estimates read the same fog (`scoutedAbility` → `estimateForTeam`).
- ko/en strings are under `scout.*` and `dev.*`, plus `inbox.scouting.weekly`, `inbox.scouting.youthIntake` and `career.enum.sign|monitor|pass`.
- Tests: `apps/desktop/test/scouting-view.test.ts` (in `test:unit`), plus the scouting steps in `test:e2e:career`: assign a youth scout, see a player as ranges, reports after the first match day, our player's development chart after a season.

## 13. Not done

- ~~Match Day and Series still play the dataset rosters~~ / ~~no real schedule~~ — done in career mode (`docs/CAREER_MODE.md`): career fixtures pass the world's fives and analysts to every series, and `advanceSeason(world, { mapsPlayed })` develops league players on the maps they really played. The Quick Match sandbox still uses dataset rosters, and development still does not read match performance (only minutes).
- **No contracts, wages, transfer fees, reputation or player agency.** Signings are needs-driven (a roster under five, an academy promotion), and there are no trades between teams.
- **No new teams.** The set of teams is fixed, so retired teams' slots are never refilled.
- ~~The user's team has no scout~~ — in a career the Scouting screen uses the manager's own scout; the Quick Match sandbox still shows the scout-less band.
- **Nothing to calibrate the development constants against.** Development, decline and retirement constants are design values with no data behind them (the curves are named in `CAREER_MODEL`, `SEASON_MODEL`, `STAFF_MODEL`, `SCOUT_MODEL`). Real players' ages are estimates.
- **Unrated real players (825 in game-data) never develop.** They have no attributes, count as league average (0.6) for squad decisions, and age out over time.
- **Scouting:** knowledge is per player, not per attribute group (a scout learns every attribute at once). There are no scouting budgets, travel or per-competition coverage beyond our league. AI clubs do not use the fog (they keep §5).
- **Development:** morale is `development.ts moraleOf` — the club's tracked value for the manager's squad (moved weekly, docs/CLUB_OPERATIONS.md §10), derived at the season end from the season's form and role for everyone else; there are no promises or complaints yet. AI clubs do not assign mentors. Personality is hidden and fixed: it does not change with age or events.
- **Academy:** there is no separate second-team competition. Academy players get minutes only through the status estimate (20 maps) or a loan.
