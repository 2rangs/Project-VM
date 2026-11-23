#!/usr/bin/env python3
"""Build the per-map knowledge the series layer needs into packages/game-data/data.

Inputs are COMMITTED derived datasets only (no DuckDB needed):

  datasets/derived/comps/<map>-comps.json     per-map agent pick rates, role templates, top comps
  datasets/derived/ratings/player_ratings.json  playerId -> agentPool (agents the player has played)

Outputs:

  packages/game-data/data/map-comps.json    { maps: { <Map>: { teamMaps, atkRoundWR, roleTemplates,
                                              pickRate, topComps } }, provenance }
  packages/game-data/data/agent-pools.json  { pools: { <playerId>: [agent slug, ...] }, provenance }

With --db (the VCT Reference DuckDB, datasets/raw/vct-reference/download.sh; needs `duckdb`):

  packages/game-data/data/map-history.json  { teams: { <teamId>: { <Map>: { games, wins,
                                              playerGames: { <playerId>: games } } } }, provenance }

Per-map team records over the same window the rosters use (season >= --min-season, default 2025;
every non-showmatch match, regional and international). `playerGames` counts the maps a player
played on that map FOR that team. The loader (packages/game-data/src/maps.ts) picks the file up
automatically; without it only the games-played counts in teams.json are known.

Usage:  python3 tools/catalog-builder/build_map_data.py [--db datasets/raw/vct-reference/vct.duckdb]
"""
from __future__ import annotations

import argparse
import glob
import hashlib
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


def build_history(db: str, min_season: int) -> dict:
    import duckdb  # only needed with --db

    with open(os.path.join(OUT, "teams.json"), encoding="utf-8") as fh:
        team_ids = [int(t["teamId"]) for t in json.load(fh)]
    con = duckdb.connect(db, read_only=True)
    games_cte = """
        WITH g AS (
          SELECT mp.match_id, mp.game_id, mp.map_name, mt.team0_id, mt.team1_id, mp.score0, mp.score1, mp.picked_by_team
          FROM maps mp JOIN matches mt ON mp.match_id = mt.match_id
          WHERE mt.season >= ? AND NOT COALESCE(mt.is_showmatch, FALSE)
            AND mp.score0 IS NOT NULL AND mp.score1 IS NOT NULL AND mp.score0 <> mp.score1
        )
    """
    team_rows = con.execute(
        games_cte
        + """
        , tm AS (
          SELECT team0_id AS team, map_name, (score0 > score1) AS won FROM g
          UNION ALL
          SELECT team1_id AS team, map_name, (score1 > score0) AS won FROM g
        )
        SELECT team, map_name, COUNT(*) AS games, SUM(CASE WHEN won THEN 1 ELSE 0 END) AS wins
        FROM tm WHERE team IS NOT NULL GROUP BY team, map_name
        """,
        [min_season],
    ).fetchall()
    player_rows = con.execute(
        games_cte
        + """
        SELECT CASE WHEN pm.team_idx = 0 THEN g.team0_id ELSE g.team1_id END AS team, g.map_name, pm.player_id, COUNT(*) AS games
        FROM player_map pm JOIN g ON pm.match_id = g.match_id AND pm.game_id = g.game_id
        GROUP BY 1, 2, 3
        """,
        [min_season],
    ).fetchall()
    picker = con.execute(
        games_cte
        + """
        SELECT COUNT(*), AVG(CASE WHEN (picked_by_team = 0 AND score0 > score1) OR (picked_by_team = 1 AND score1 > score0) THEN 1.0 ELSE 0.0 END)
        FROM g WHERE picked_by_team IN (0, 1)
        """,
        [min_season],
    ).fetchone()
    wanted = set(team_ids)
    teams: dict = {}
    for team, map_name, games, wins in team_rows:
        if team in wanted:
            teams.setdefault(str(team), {})[map_name] = {"games": int(games), "wins": int(wins), "playerGames": {}}
    for team, map_name, player, games in player_rows:
        rec = teams.get(str(team), {}).get(map_name)
        if rec is not None and player is not None:
            rec["playerGames"][str(player)] = int(games)
    with open(db, "rb") as fh:
        sha = hashlib.sha256(fh.read()).hexdigest()
    return {
        "teams": teams,
        "provenance": {
            "source": "VCT Reference DuckDB (maps, matches, player_map)",
            "sourceUrl": "https://vct-reference.com/dataset/vct.duckdb",
            "sha256": sha,
            "window": f"season >= {min_season}, showmatches excluded, regional + international",
            "league": {"pickedMaps": int(picker[0]), "pickerWinRate": round(float(picker[1]), 4)},
            "note": "wins/games are maps; playerGames = maps the player played on that map for that team.",
        },
    }


def write(name: str, obj: dict) -> None:
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="VCT Reference DuckDB; when given, also writes map-history.json")
    ap.add_argument("--min-season", type=int, default=2025, help="first season of the team-record window")
    args = ap.parse_args()
    comps = build_comps()
    pools = build_pools()
    write("map-comps.json", comps)
    write("agent-pools.json", pools)
    print(f"map-comps.json: {sorted(comps['maps'])}; agent-pools.json: {len(pools['pools'])} players")
    if args.db:
        history = build_history(args.db, args.min_season)
        write("map-history.json", history)
        print(f"map-history.json: {len(history['teams'])} teams; picker win rate {history['provenance']['league']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
