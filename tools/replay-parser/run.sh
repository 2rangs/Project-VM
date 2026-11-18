#!/usr/bin/env bash
# PROJECT V — PV-6 one-command Linux replay pipeline.
#
#   tools/replay-parser/run.sh <replay.vrf> [mapName] [outDir]
#
# Decodes a .vrf with the Linux-built ValorantReplayParser, then runs the PV-6
# extract + normalize stages to produce normalized Layer-B data.
#
# Requires the parser binary. Point PARSER at it, or drop it at
# tools/replay-parser/bin/ValorantReplayParser. Build instructions:
# docs/research/replay-parser.md §"Linux build".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VRF="${1:?usage: run.sh <replay.vrf> [mapName] [outDir]}"
MAP="${2:-}"
OUT="${3:-$HERE/output/$(basename "${VRF%.*}")}"
PARSER="${PARSER:-$HERE/bin/ValorantReplayParser}"

if [[ ! -x "$PARSER" ]]; then
  echo "parser binary not found/executable at: $PARSER" >&2
  echo "see docs/research/replay-parser.md (Linux build) or set PARSER=/path/to/ValorantReplayParser" >&2
  exit 1
fi

mkdir -p "$OUT"
echo "[1/3] decode  $VRF"
VRP_CHANNELS="$OUT/channels.jsonl" "$PARSER" "$VRF" --verbose --full > "$OUT/decode-full.txt" 2> "$OUT/parser.stderr"

echo "[2/3] extract -> raw.json"
node "$HERE/src/extract.mjs" "$OUT/decode-full.txt" "$OUT/raw.json"

echo "[3/3] normalize -> normalized.json"
node "$HERE/src/pipeline.mjs" "$OUT/raw.json" "$OUT/channels.jsonl" "$OUT/normalized.json" "$MAP" "$VRF"

# decode-full.txt is large (0.1-1+ GB on a full match); drop it unless KEEP_DECODE=1.
if [[ "${KEEP_DECODE:-0}" != "1" ]]; then rm -f "$OUT/decode-full.txt"; fi
echo "done -> $OUT/normalized.json"
