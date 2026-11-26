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

### Identity proof (all pass)
- `runMatch` signature (`packages/match-runner/scripts/match-signature.mts`, 5 team/seed/map pairs,
  SHA-256 over score + every round's winner/reason/buys/kills/economy + all events + both plans):
  **`10fa0cda…99d2`, identical** on pristine main `97db384` and on this branch.
- **sim-batch 1–160** (seeds 1..160, Ascent, real rosters): the deterministic bundle content
  (`engine` + `rounds`) hashes to **`1efc66f3…`, identical** branch vs main (ran the batch on each,
  SHA-256 of the two bundles' rounds+engine).
- Engine determinism suites unchanged: round-simulator 165/1 skip, perception-engine 32, spatial-engine
  442/22 skip, match-runner all pass (incl. "same seed → same match, plans included", roster
  byte-identity, recorded-movement-on-floor).
- `apps/desktop` `test:engine` (bundle == source): **10 pass / 0 fail**.

---

## 2. Career progression speed and footprint (low-spec principle)

"Must not be hardware-demanding like FM/OOTP — must run on a weak PC." Measured on this 4-core
container with `tools/career/measure-footprint.mts` and `tools/career/season-timing.mts` (seed 2026,
game-data world of **1,267 players / 70 teams**, 519 series/season). These feed the targets below.

**A season by sim depth** (`pv-career-depth`): the AI series are the whole cost; one engine series is
~2.4 maps.

| depth | what runs through the engine | season time | note |
|---|---|---|---|
| `quick` | nothing (formula estimate) | **~1–2 s** | default in the browser; other regions + internationals always |
| `league` (default) | the manager's own league only (~93 series) | **~10.8 min** | the player-facing wait each season |
| `full` | everything (519 series) | **~61 min** | opt-in |

**The engine tick-loop fix (§1) carries straight into career**, because the AI series run through the
same engine:

| | engine s / series | engine-depth season (519 series) |
|---|---|---|
| before (main `97db384`) | 10.95 | ~91 min |
| after (this branch) | **8.64** | **~72 min** |

**−21 % per engine series**, byte-identical. (The synthetic perf fixture saw −33.6 %; a real match has
buy-phase/economy/decision work outside the perception pass, so the whole-match gain is smaller.)

**Memory and save size** (`measure-footprint.mts`):

| | value |
|---|---|
| peak RSS, a quick season + a few engine series | **~280–342 MB** |
| peak heap | ~52 MB |
| one engine series (runSeries) peak RSS incl. world | ~342 MB |
| career save (`serializeCareer`), after 1 / 3 seasons | 1.9 MB / 2.7 MB raw; **0.2 MB gzipped** |

The world JSON is almost the whole save; the save grows slowly and stabilises (population is capped by
intake = retirement), and gzip shrinks it ~10×.

### Proposed low-spec targets (4-core / 8 GB)
Memory is already comfortable; the lever is engine-depth time and keeping the save small.

| metric | current (this machine) | proposed target | how |
|---|---|---|---|
| peak RSS (main + one engine worker) | ~342 MB | **< 600 MB** | met; watch it doesn't regress |
| career save on disk | 1.9–2.7 MB raw | **< 0.5 MB** | gzip the save (already 0.2 MB gzipped) — storage change, byte-identical content |
| `quick`-depth season | ~1–2 s | **< 5 s** | met |
| `league`-depth season | ~10.8 min (this 4-core box; ~1.5–2× on a weak CPU ⇒ ~16–22 min) | **< 8 min on a reference mid machine** | the §1 fix got engine series to 8.64 s; the rest is below |

### Further career speedups — NOT applied (report only, per the brief)
These change results or defaults, so they are flagged for the orchestrator, not done here:
1. **Make `quick` the default for the manager's own league too.** The P2-9 refit left the quick sim
   well-calibrated (ECE 0.011, the 90–100 % bin flat). That would cut a `league` season from ~10.8 min
   to ~1–2 s. It changes what the player sees (formula vs engine results), so it is a product/default
   decision — recommended, reported, not flipped.
2. **Gzip the career save** on disk (0.2 MB vs 1.9 MB). Byte-identical content; a storage-layer change
   in the worker/save path. Low risk, but it touches the desktop save I/O — proposing it.
3. Any further engine-tick reduction beyond the byte-identical §1 fix (fewer ticks, coarser perception)
   would change match results → behind a flag, measured, reported.

---

## 3. Main desktop e2e check
The 28th merge did not run the desktop `test:e2e` / `test:e2e:series` / `test:e2e:club` suites.
Run on the final main (this container, xvfb + swiftshader; the engine is byte-identical to main, §1):

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
