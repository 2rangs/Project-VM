# Handoff — performance (P2-12) and the main desktop e2e check

Branch `claude/pv3-perf` (from main `97db384`). Third work bundle, session E. Not merged; the
integrator runs the combined gate and the merge.

Scope rule for this bundle: **data structures and caches only, no behaviour change** — sessions A–D
own `policy.ts` and the simulation behaviour. Every change here is proven byte-identical (the
`runMatch` signature and the engine determinism suites are unchanged).

---

## 1. Quick sim / round-simulator speed (P2-12)

### Goal
`packages/round-simulator/test/perf.test.ts` (1,000 synthetic rounds, 60 s ceiling) had drifted to
49–69 s under load and overran the cap once at the 28th merge. Target: **≥ 30 % faster, results
byte-identical** (no optimisation that changes the sim).

### Profile (V8 `--prof`, 300 rounds of the perf fixture)
The tick loop itself is cheap; the time is in the spatial/perception queries it drives:

| self time | symbol | where |
|---|---|---|
| **20.1 %** | `Builtin: MathHypot` | all the distance work below |
| 5.2 % | `sees` | `navigation.ts` — node-to-node line of sight |
| 5.0 % | `FindOrderedHashMapEntry` | Map lookups |
| 3.0 % / 2.6 % | `search` / `findPath` | A* pathfinding |
| 1.6 % | `locate` | nearest roadmap node to a position |

`Math.hypot` cannot be swapped for `Math.sqrt(dx*dx+…)`: on game-range coordinates the two disagree
by a ULP ~38 % of the time (measured), which would diverge the sim. So the win had to come from
**not computing the same distances twice**, not from changing the arithmetic.

### The redundancy
Perception's visibility is O(n²): `PerceptionEngine.perceive` → `currentlyVisible(observer)` → for
every target `oracle.canSee(observer, target)` → `lineOfSight` → `nav.sees(obsPos, …, tgtPos, …)`,
and `sees` **locates both positions every call**. So each of the 10 players' positions is located
~10× per tick (once per pairing) when it only needs locating once — the located node is a pure
function of (position, zone), fixed for the tick.

### The fix (byte-identical cache)
Locate each body once per perception tick and reuse the node across every pairing:

- `packages/spatial-engine/src/navigation.ts`: split `sees` into `sees` (locate + decide) and a new
  **`seesNodes(na, nb, a, b)`** that takes the already-located nodes and runs the identical
  range-and-visibility decision. `sees` now delegates to it, so its result is unchanged.
- `packages/perception-engine/src/vision.ts`: `SightOptions`/`VisionContext` gain an optional
  `nodeCache: Map<object, number|null>` (position object → located node). `lineOfSight` consults it
  (`locateInZone` on a miss, then `seesNodes`) instead of calling `sees`. Without a cache the path is
  exactly the old `sees` call.
- `packages/perception-engine/src/oracle.ts`: the cache is built once per world object via a
  `WeakMap<world, Map>` — the same per-world pattern already used for `smokedPairs`. `toPerceptionWorld`
  makes a fresh world each tick, so the cache is naturally one-tick-scoped and self-expiring, and
  positions are read-only during a perception pass, so a position object maps to one node for the
  cache's life.

No navigation/perception behaviour changes: the located node, the range check and the visibility bit
are the same values, computed once instead of n times.

### Result
`perf.test.ts`, 1,000 rounds, this container:

| | ms/round | 1,000 rounds | attack win rate |
|---|---|---|---|
| before (main `97db384`) | 48.84 | 48.8 s | 0.530 |
| after | **32.40** | **32.4 s** | 0.530 |

**−33.6 %**, attack win rate identical. Comfortable margin under the 60 s cap even under load.

### `routeCache` — left as is
`routeCache` (`team-engine/src/policy.ts`) already memoises `planRoute`/`findPath` per
`from>to|mid` and is a cheap Map; the perf fixture uses `ScriptedPolicy` and does not exercise it.
Its result depends on `siteWatched()`/`midZones()` state that the key does not include, so changing
its keying or lifetime would change results — out of bounds for a byte-identical pass, and it sits in
`policy.ts` which A–D own. Left untouched.

### Identity proof
- `runMatch` signature (`packages/match-runner/scripts/match-signature.mts`, 5 team/seed/map pairs,
  SHA-256 over score + every round's winner/reason/buys/kills/economy + all events + both plans):
  **`10fa0cda…99d2`, identical before and after.**
- Engine determinism suites unchanged: round-simulator 165/1 skip, perception 32, spatial 442/22 skip,
  match-runner <!-- FILL -->.
- `apps/desktop` `test:engine` (bundle == source): <!-- FILL -->.
- sim-batch 1–160: <!-- FILL -->.

---

## 2. Main desktop e2e check
The 28th merge did not run the desktop `test:e2e` / `test:e2e:series` / `test:e2e:club` suites.
Run on the final main (this container, xvfb + swiftshader):

<!-- FILL: results per suite; diagnoses for any failure -->

---

## Re-run commands
- Perf: `node_modules/.bin/vitest run --root packages/round-simulator perf`
- runMatch signature: `cd packages/match-runner && ../../node_modules/.bin/tsx scripts/match-signature.mts`
- Engine suites: `node_modules/.bin/vitest run --root packages/{round-simulator,perception-engine,spatial-engine,match-runner}`
- Bundle == source: `cd apps/desktop && npm run build && PLAYWRIGHT_REQUIRE_BASE=/opt/node-tools/ npm run test:engine`
- Desktop e2e: `cd apps/desktop && npm run build && xvfb-run -a env PLAYWRIGHT_REQUIRE_BASE=/opt/node-tools/ node test/e2e.<name>.test.mjs`

## Left to do
<!-- FILL -->
