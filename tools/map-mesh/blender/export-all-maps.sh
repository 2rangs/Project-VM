#!/bin/bash
# Build the web GLB for every map (or the ones named), one at a time through the shared heavy-run lock.
#   tools/map-mesh/blender/export-all-maps.sh            # all eleven
#   tools/map-mesh/blender/export-all-maps.sh haven bind # some
# Env: PV_ASSETS (default ~/ProjectV-assets), BLENDER (default $PV_ASSETS/tools/Blender.app/Contents/MacOS/Blender).
# Output (never in git): $PV_ASSETS/maps/glb/<map>.glb, <map>.report.json, <map>.export.log, <map>-preview-*.png
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PV_ASSETS="${PV_ASSETS:-$HOME/ProjectV-assets}"
BLENDER="${BLENDER:-$PV_ASSETS/tools/Blender.app/Contents/MacOS/Blender}"
HEAVY="$PV_ASSETS/tools/heavy-run.sh"
OUT="$PV_ASSETS/maps/glb"
MAPS=("$@"); [ ${#MAPS[@]} -eq 0 ] && MAPS=(abyss ascent bind breeze fracture haven icebox lotus pearl split sunset)
mkdir -p "$OUT"
cd "$ROOT"
for m in "${MAPS[@]}"; do
  B="$(tr '[:lower:]' '[:upper:]' <<< "${m:0:1}")${m:1}"
  run=("$BLENDER" --background --factory-startup --python tools/map-mesh/blender/export-web-glb.py --
       --blend "$PV_ASSETS/maps/raw/$B.blend" --map "$m" --spatial datasets/spatial
       --out "$OUT/$m.glb" --report "$OUT/$m.report.json" --preview-dir "$OUT")
  echo "== $m"
  if [ -x "$HEAVY" ]; then "$HEAVY" "map-glb $m" -- "${run[@]}" > "$OUT/$m.export.log" 2>&1
  else "${run[@]}" > "$OUT/$m.export.log" 2>&1; fi
  grep -E "^(EXPORT-WEB-GLB|CALIBRATION|VERIFY)" "$OUT/$m.export.log" || { echo "!! $m failed — see $OUT/$m.export.log"; tail -20 "$OUT/$m.export.log"; }
done
