#!/usr/bin/env python3
"""Build the per-map knowledge the series layer needs into packages/game-data/data.

Inputs are COMMITTED derived datasets only (no DuckDB needed):

  datasets/derived/comps/<map>-comps.json     per-map agent pick rates, role templates, top comps
  datasets/derived/ratings/player_ratings.json  playerId -> agentPool (agents the player has played)

Outputs:

  packages/game-data/data/map-comps.json    { maps: { <Map>: { teamMaps, atkRoundWR, roleTemplates,
                                              pickRate, topComps } }, provenance }
  packages/game-data/data/agent-pools.json  { pools: { <playerId>: [agent slug, ...] }, provenance }

Per-map TEAM RESULTS (wins/losses per map, per-player games per map) are NOT in the committed
datasets — they need the VCT Reference DuckDB. When that is available, write
packages/game-data/data/map-history.json in the shape documented in
packages/game-data/src/maps.ts (TeamMapHistoryBundle); the loader picks it up automatically.

Usage:  python3 tools/catalog-builder/build_map_data.py
"""
from __future__ import annotations

import glob
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "packages", "game-data", "data")

ALIASES = {"kayo": "kay-o", "kay/o": "kay-o"}


def norm_agent(slug: str) -> str:
    s = slug.strip().lower()
    return ALIASES.get(s, s)


def build_comps() -> dict:
    maps = {}
    sources = []
    for path in sorted(glob.glob(os.path.join(ROOT, "datasets", "derived", "comps", "*-comps.json"))):
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        sources.append(os.path.relpath(path, ROOT))
        maps[d["map"]] = {
            "teamMaps": d["overall"]["teamMaps"],
            "atkRoundWR": d["overall"]["atkRoundWR"],
            "patchRange": d.get("patchRangeNumeric"),
            "roleTemplates": [
                {"template": t["template"], "maps": t["maps"], "share": t["share"]} for t in d["roleTemplates"]
            ],
            "pickRate": [
                {"agent": norm_agent(p["agent"]), "role": p["role"], "pickRate": p["pickRate"], "maps": p["maps"]}
                for p in d["pickRate"]
            ],
            "topComps": [
                {
                    "comp": sorted(norm_agent(a) for a in c["comp"]),
                    "maps": c["maps"],
                    "mapWinRate": c["mapWinRate"],
                }
                for c in d["topComps"]
            ],
        }
    return {
        "maps": maps,
        "provenance": {
            "source": "VCT Reference (international), via datasets/derived/comps",
            "files": sources,
            "note": "Aggregates blend several patches; see each source file's sampleCaveats.",
        },
    }


def build_pools() -> dict:
    path = os.path.join(ROOT, "datasets", "derived", "ratings", "player_ratings.json")
    with open(path, encoding="utf-8") as fh:
        ratings = json.load(fh)
    pools = {str(r["playerId"]): sorted({norm_agent(a) for a in r.get("agentPool") or []}) for r in ratings}
    return {
        "pools": pools,
        "provenance": {
            "source": "VCT Reference player_map agents, via datasets/derived/ratings/player_ratings.json",
            "note": "An agent is listed if the player has ever played it in the dataset; there are no per-agent or per-map counts.",
        },
    }


def write(name: str, obj: dict) -> None:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")


def main() -> int:
    comps = build_comps()
    pools = build_pools()
    write("map-comps.json", comps)
    write("agent-pools.json", pools)
    print(f"map-comps.json: {sorted(comps['maps'])}; agent-pools.json: {len(pools['pools'])} players")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
