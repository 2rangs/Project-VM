#!/usr/bin/env bash
# Download the VCT Reference DuckDB (real, verified source).
#
#   Source : https://vct-reference.com/dataset/vct.duckdb
#   Size   : ~13 MB (13,381,632 bytes on the 2026-11-12 build)
#   Tables : matches, maps, rounds, player_map, kill_matrix, notables, players,
#            teams, stat_source, feed_fill_meta
#   License: free to use incl. commercially, no warranty; see https://vct-reference.com/terms
#            (independent hobby project, data from public pro match pages; not affiliated with Riot)
#
# The file is rebuilt daily at a permanent URL, so it is not committed to git (see .gitignore).
set -euo pipefail
cd "$(dirname "$0")"
URL="https://vct-reference.com/dataset/vct.duckdb"
OUT="vct.duckdb"
echo "Downloading $URL -> $OUT"
curl -fSL --retry 4 --retry-delay 2 -o "$OUT" "$URL"
echo "SHA-256:"
sha256sum "$OUT" || shasum -a 256 "$OUT"
echo "Done. Normalize a match with:"
echo "  PYTHONPATH=tools/data-collector/src python3 -m pv_data_collector.cli \\"
echo "    normalize-vct --db datasets/raw/vct-reference/vct.duckdb --match 754737 \\"
echo "    --out datasets/normalized/vct-reference"
