#!/usr/bin/env bash
# One-line refit of the quick series estimate against the CURRENT match engine.
#
#   bash tools/career/refit-quick-sim.sh [series=1100] [seed=2026] [shards=nproc]
#
# 1. Plays `series` Bo3s through match-runner (runSeries), fanned out across `shards` processes
#    (each an independent team-draw stream, globally unique match seeds), into shard caches.
# 2. Merges the shards into ONE large cache keyed by `seed` at $PV_LARGE_CACHE
#    (tools/career/calibration-data.large.json by default — gitignored, DO NOT COMMIT; it is big).
# 3. Runs the maximum-likelihood fit (fit-quick-sim.mts) on that cache, estimating the per-map and
#    per-series noise from the data, and writes the summary + calibration curve to
#    tools/career/quick-sim-refit.json (committed) and to stdout.
#
# Re-runnable as-is after the engine changes: it always replays the engine (no stale cache reuse).
# ~3.5-9 s per series per core; 1100 series on 4 cores ≈ 40-70 min.
set -euo pipefail

SERIES="${1:-1100}"
SEED="${2:-2026}"
SHARDS="${3:-$(nproc 2>/dev/null || echo 4)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TSX="$ROOT/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "tsx not found at $TSX — run: npx -y pnpm@10.28.0 install --frozen-lockfile" >&2; exit 1; }

LARGE="${PV_LARGE_CACHE:-$ROOT/tools/career/calibration-data.large.json}"
SUMMARY="$ROOT/tools/career/quick-sim-refit.json"
TMPDIR_SH="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SH"' EXIT

echo ">> generating $SERIES engine Bo3s across $SHARDS shards (seed $SEED)" >&2
pids=()
for ((i=0; i<SHARDS; i++)); do
  PV_CALIBRATION_DATA="$TMPDIR_SH/shard-$i.json" \
    "$TSX" "$ROOT/tools/career/calibrate-quick-sim.mts" "$SERIES" "$SEED" --refit --gen-only "--shard=$i/$SHARDS" \
    >"$TMPDIR_SH/shard-$i.out" 2>"$TMPDIR_SH/shard-$i.err" &
  pids+=($!)
done
fail=0
for ((i=0; i<SHARDS; i++)); do
  if wait "${pids[$i]}"; then echo ">> shard $i done ($(tail -1 "$TMPDIR_SH/shard-$i.err"))" >&2
  else echo "!! shard $i FAILED:" >&2; tail -5 "$TMPDIR_SH/shard-$i.err" >&2; fail=1; fi
done
[ "$fail" = 0 ] || { echo "!! a shard failed; aborting" >&2; exit 1; }

echo ">> merging shards -> $LARGE" >&2
"$TSX" -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const [, out, seedStr, ...files] = process.argv;
  const seed = Number(seedStr);
  const played = [];
  for (const f of files) { const d = JSON.parse(readFileSync(f, "utf8")); if (d.seed !== seed) throw new Error(`shard seed ${d.seed} != ${seed}`); played.push(...d.played); }
  writeFileSync(out, JSON.stringify({ seed, engineSecondsPerSeries: null, played }));
  process.stderr.write(`merged ${played.length} series\n`);
' "$LARGE" "$SEED" "$TMPDIR_SH"/shard-*.json

echo ">> fitting on $LARGE (refit-report.mts: analytic MLE, bounded for thousands of series)" >&2
PV_CALIBRATION_DATA="$LARGE" "$TSX" "$ROOT/tools/career/refit-report.mts" --bootstrap=24 --reps=200 >"$SUMMARY"
echo ">> summary written to $SUMMARY" >&2
cat "$SUMMARY"
