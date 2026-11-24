# PROJECT V — Mid control (research and gap map)

> Research only; no engine code changed. Written 2026-11-24 on `origin/main` 7073bac.
> Maps-data's mid-control work lives on `claude/nav-engine` (not merged): `packages/spatial-engine/src/tactics.ts`
> (derived `mid` anchor, `approachSide`, `attackerGround`, `defenderStarts`), `docs/research/ASCENT_TACTICS.md`, `MAPS_DATA.md`.
> Gap statuses are against main plus that branch where stated. Related: [`LURKER_ROLE.md`](LURKER_ROLE.md), [`PLANT_POSTPLANT.md`](PLANT_POSTPLANT.md).
> Design rule: attribute × situation → named formula; acts on team belief; no flat bonuses.

## 0. Summary

- **What mid is for:** a hub from which an attack can reach either site (splits), rotate, gather information, send a lurker, and cut the
  defence's rotation lane. Giving mid up means the defence has to guess; taking it means the attack picks the hit after seeing the answer.
- **Hard evidence is thin.** No source gives a mid-control win rate, a split-hit rate or first-kill *location* vs round win. The only related number
  is first blood → round win ≈ 71 % (Masters Berlin 2021; no baseline). Everything about mid below is qualitative guide material; the numbers that
  exist (map side win rates, §5) do not isolate mid.
- **Engine state:** mid control exists as a *label* (`midControl` strategy, derived mid anchor for defenders on maps that have a mid zone). It plays as a
  slow play with no mid-specific fight, split or cost of losing it. Maps with no mid zone (Bind, Fracture, Lotus) have none.

## 1. Sources

Metabot [map control and defaults](https://metabot.gg/en/valorant/guides/valorant-map-control-defaults-executes); Business Upturn
[pro Ascent defaults](https://businessupturn.com/usa/business/tech/gaming/how-pro-teams-approach-defaulting-on-ascent/);
Cogconnected [maps](https://cogconnected.com/?p=375366) (inconsistent figures, *unconfirmed*);
Red Bull [Split guide](https://www.redbull.com/gb-en/valorant-split-map-guide); Mobalytics [Sunset overview](https://mobalytics.gg/blog/valorant/sunset-new-map-overview/);
Esports.net [Sunset](https://www.esports.net/news/valorant/sunset-map/) and [Corrode](https://www.esports.net/wiki/guides/valorant-corrode-map);
Dotesports [Haven](https://dotesports.com/?p=511976); Upcomer [Masters Berlin](https://upcomer.com/answering-valorant-masters-berlin-questions-part-1);
THESPIKE [Champions 2025 maps](https://www.thespike.gg/valorant/news/valorant-champions-2025-map-analysis-trends-and-insights/6917);
bo3.gg Haven (snippet only). Fetches that failed: Liquipedia statistics, several Mobalytics pages.

## 2. What mid gives, per map (qualitative)

| Map | Mid role (paraphrased) |
|---|---|
| Ascent | hub: holding Catwalk / Market lets attackers reach A or B before the defence reacts; pros commit several players and utility and smoke lanes such as Market and A Heaven; defender default is often 2-1-2 with a mid player (Metabot, Business Upturn; the 2-1-2 line is search-summary level) |
| Haven | courtyard and Garage connect all three sites; owning mid lets attackers go anywhere, losing it exposes B and Garage for the defence; C Long + Connector splits are common (Cogconnected, Dotesports) |
| Bind | no mid lane; teleporters connect sites, which lets defenders reinforce a lost site but reveals the move (Cogconnected) |
| Split | no wide mid; Viper/Omen-heavy comps; mid control "often decides games early" (Red Bull) |
| Sunset | Mid Courtyard is the rotation hub; Top Mid can pick off rotators; prioritise Market control (Mobalytics, Esports.net) |
| Corrode | mid is critical: Shallow Mid → A Link, Deep Mid → B splits; A-Link and B-Link are defender power positions (Esports.net, Cogconnected) |
| Pearl, Abyss | securing Mid Plaza (Pearl) or mid early (Abyss) gives access to both sites and cuts rotations (Cogconnected) |
| Icebox, Breeze, Fracture, Lotus | not found |

## 3. How teams fight for mid, and what losing it costs

| Behaviour | Source summary |
|---|---|
| Attack default | take space first, probe with info agents (Sova, Fade), then split or execute; smokes on rotation lanes; drain defender utility (Business Upturn) |
| Timing template (one guide, not pro data) | take space 0:00–0:15, default 0:15–0:40, commit or fake 0:40–0:55, execute 0:55–1:15; at least one smoke and one flash per site hit (Metabot) |
| Fakes | pressure one site, wait for the defence to leave, collapse onto the other (Metabot) |
| Defence | hold mid with one player, or give it up and play retake-heavy (Haven B with an initiator nearby; bo3.gg, snippet); early picks from Garage / A Short aggression |
| Dedicated mid player | a deep-mid turret with a solo sentinel; Sova, Breach, Viper named as mid agents (Esports.net, Corrode) |
| Cost of losing mid | qualitative: you lose the fastest rotation lane and the ability to threaten both sites; the attack's later splits are cheaper (Cogconnected) |
| Split hits | pincer from two lanes after mid is held (the collapse structure in `LURKER_ROLE.md` §2); no rate found |

## 4. Numbers

| Number | Value | Source |
|---|---|---|
| First blood → round win | 71.39 % (Masters Berlin, no sample size, no baseline) | [Upcomer](https://upcomer.com/answering-valorant-masters-berlin-questions-part-1) |
| First-kill **location** → round win | **not found** | — |
| Split-hit rate; mid-control win rate | **not found** | — |
| Champions 2025 attack win: Abyss 57.93 %, Haven 57.73 %, Lotus 51.04 %; defence: Sunset 60.44 %, Bind 54.94 % | map-level only, nothing about mid | [THESPIKE](https://www.thespike.gg/valorant/news/valorant-champions-2025-map-analysis-trends-and-insights/6917) |
| Our `vct.duckdb`: attack win by map (156,767 rounds) | Ascent 0.473, Split 0.493, Sunset 0.493, Pearl 0.498, Bind 0.507, Breeze 0.510, Fracture 0.514, Icebox 0.518, Haven 0.520, Lotus 0.524, Abyss 0.541 | `rounds` joined to `maps` |
| Our data: first kill, location, kill times | none — `vct.duckdb` has no kill events or positions; only the winner side and end type | — |

The only related data we hold is the aggregate in `docs/research/status-audit-2026-11-23` for our own sim (first kill by the attack 46.2 %, first kill → 72.4 % round win), which matches the real 71.4 %.

## 5. Gap map

Status columns: **main** = 7073bac; **maps** = `claude/nav-engine` where it differs.

| # | Behaviour | main | maps | Evidence / missing |
|---|---|---|---|---|
| M1 | Mid exists as a zone type; derived "mid anchor" for defenders | 🟡 | ✅ | `tactics.ts`: anchor = type `mid` zone the defence reaches first and the attack reaches soonest after (hand override on Ascent: `mid-courtyard → mid-top`). Absent on Bind, Fracture, Lotus (no `mid` zone; `MAPS_DATA.md` #22) |
| M2 | `midControl` strategy | 🟡 | 🟡 | selected by `igl.ts:186/195` with weight 0.8; `policy.ts` treats it as a default/slow play (the "no site named" branch of `bindObjective`). The audit found no mid-control routes in sim (mid route in 0.7 % of rounds) |
| M3 | Attack takes mid with a mid player/utility (smokes, recon) | ❌ | ❌ | no mid-specific smokes or positions (`SMOKE_TARGETS` has `mid-top` only for Ascent; maps derive `smokes[mid]`) |
| M4 | Defence holds or gives mid (dedicated mid player) | 🟡 | ✅ | mid anchor start (`defenderStarts` last, two-site maps) exists on the maps branch; no decision to hold vs give up mid |
| M5 | Mid fight: who gets to hold mid, ground ownership | ❌ | 🟡 | `attackerGround` = zones the attack reaches first (static); no dynamic control state |
| M6 | Split hit (two lanes onto one site) | ❌ | ❌ | `StaticPlan` has a single objective; the staging rule makes everyone stage and go together (`policy.ts` `executeGo`). No lane assignment per site entry |
| M7 | Rotations through / cut by mid | 🟡 | ✅ | `approachSide` reads an unnamed zone (mid) as coming for a site (d3d3111); rotation reads exist in `hit-belief.ts`; no cut |
| M8 | Info from mid (recon, contact timing) | 🟡 | 🟡 | generic intel; nothing mid-specific |
| M9 | Lurk from mid | 🟡 | 🟡 | `LURKER_ROLE.md` (lurker holds far side only) |
| M10 | Cost of losing mid (rotation time, split options) | ❌ | ❌ | none: derived travel times exist, but no belief that "I lose control ⇒ rotations are slower / splits are possible" |
| M11 | Defender mid aggression / info push | 🟡 | 🟡 | `aggroPush` has a fixed weight (`igl.ts:151`, STAT §7) |
| M12 | Map-specific mid defaults (Bind teleporters, Split ropes, Corrode links) | ❌ | 🟡 | traversal edges exist (`mover.ts`), not used in decisions |

## 6. Proposed formulas

Notation: `B` = belief; `t_A(z), t_D(z)` = attack/defence travel time to zone `z` (planning times, already available);
`C(z) ∈ [−1,1]` = control of zone `z`; `ρ` = logit choice; `g` = gameSense.

**M5 Control state.** `C(z)` updates by evidence: `C ← C + η(v − C)` where `v` = +1 if the attack's players or utility are in/see `z` with no defender seen for τ, −1 for the reverse, 0 else (the same info-decay form as `infoWeight`, half-life from `trading`). Initial value from the static travel-time difference `(t_D − t_A)/T`.

**M3/M4 Take or give mid (decision).** For the attack: `V(take) = P(win mid duel | numbers, util, B)·V(control) − P(lose)·cost(player)`; `V(control)` = value of the options control opens = reduction in the defence's `P(correct rotation)` (hit-belief entropy) plus the split option value below. For the defence: hold mid with one player if `V(info) + V(delay) > P(die)·value(player)`, else give it up and use the retake-heavy setup. `aggression`, `discipline`, `decisionMaking` give the logit temperature; `mapAwareness` (null today) the noise in `C(z)`.

**M6 Split.** After mid control `C(mid) > θ` the attack's plan may be a two-lane hit: choose entries `e₁, e₂` onto the same site minimising the defence's crossfire cover (`Σ P(defender at entry spot)`) and maximising the Hick–Hyman `n` on the holders, with arrival offset `Δ ≤ T_trade`:
`V(split) = P(win | n = 2 guns, Δ) − P(win | single file)`. Chosen when `V(split) > V(straight)` and utility for both lanes exists. `teamwork` sets the standard deviation of `Δ`.

**M10 Cost of losing mid.** `rotateTime(site→site)` becomes `t_D + wait + risk`, where risk = `P(attack covers the path)·P(loss)`, computed from `C(z)` along the route. This feeds `hit-belief`'s rotation count and `decideDefenseRotation`: with low `C(mid)` a rotation sends fewer players or stays (the defence correctly fears being caught).

**M7 Cutting rotations** reuses the lurker formula `LURKER_ROLE.md` L6.

**M12 Map-specific.** Derive from edges: a teleporter/rope edge changes `t_A`/`t_D`, and its sound (MS-09) adds belief evidence; no hand tables.

## 7. Tests (counterfactuals)

1. Attack with a mid player vs without, same plan: the defence's rotation count at the first contact falls when mid control is held; report arrival times.
2. Split hit vs straight hit onto the same site with a held mid: more defender deaths at the site; plant rate up; report both.
3. Defence that gives mid up vs holds it: info push gains vs loses a player; show the break-even on `aggression`/`decisionMaking`.
4. Cost of losing mid: with `C(mid) < −θ` the defence keeps more players on the sites and rotates later; verify using `hit-belief` traces.
5. 160 matches real rosters: route diversity (audit: 23 attacker routes, mid route in 0.7 % of rounds), plant time (pro 52–60 s), first-kill timing (sim p50 14.5 s), site split of attacks (50/50), per-map attack win vs the table in §4 (own geometry).

## 8. Data we don't have

| Data | Use | Source |
|---|---|---|
| First-kill location vs round win; mid-fight outcomes; split-hit rates by map | calibrate M3–M6 | GRID Open Access event/position feed if available; own VOD coding; vlr.gg / rib.gg as reference only (ToS check) |
| Which zone counts as "mid" per map (Bind, Fracture, Lotus have none) | M1 | maps session: define a mid-equivalent super-region per map |
| Pro mid-control timing (when mid is taken, when it is lost) | M5 | event data as above |
| Mid-specific lineups (smokes onto Market, A Heaven, etc.) | M3 | own measurement; community lineup sites as pointers |

## 9. Owners

- **maps** (`claude/nav-engine`): mid-equivalent zones for the three maps without one; per-map mid smokes and holding spots; lane/entry data for splits (`SiteTactics.entries` exists).
- **engine-truth** (`team-engine`: `igl.ts`, `policy.ts`, `hit-belief.ts`): M2–M6, M10, M11; control state and split plans.
- **UI:** a control-state overlay (who holds mid), split arrows in Review.
