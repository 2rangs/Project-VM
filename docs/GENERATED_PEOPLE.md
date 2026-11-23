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

## 9. Not done

- ~~Match Day and Series still play the dataset rosters~~ / ~~no real schedule~~ — done in career mode (`docs/CAREER_MODE.md`): career fixtures pass the world's fives and analysts to every series, and `advanceSeason(world, { mapsPlayed })` develops league players on the maps they really played. The Quick Match sandbox still uses dataset rosters, and development still does not read match performance (only minutes).
- **No contracts, wages, transfer fees, reputation or player agency.** Signings are needs-driven (a roster under five, an academy promotion), and there are no trades between teams.
- **No new teams.** The set of teams is fixed, so retired teams' slots are never refilled.
- ~~The user's team has no scout~~ — in a career the Scouting screen uses the manager's own scout; the Quick Match sandbox still shows the scout-less band.
- **Nothing to calibrate the development constants against.** Development, decline and retirement constants are design values with no data behind them (the curves are named in `CAREER_MODEL`, `SEASON_MODEL`, `STAFF_MODEL`, `SCOUT_MODEL`). Real players' ages are estimates.
- **Unrated real players (825 in game-data) never develop.** They have no attributes, count as league average (0.6) for squad decisions, and age out over time.
