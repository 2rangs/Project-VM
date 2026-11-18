"""Normalize the real VCT Reference DuckDB into PROJECT V's schema.

Verified source (2026-11-18): https://vct-reference.com/dataset/vct.duckdb
  * 13,381,632 bytes, 10 tables, rebuilt daily, free to use incl. commercially (see terms).
  * This normalizer reads it read-only; it never fabricates missing values.

Every emitted record carries real (synthetic=False) provenance. Fields that the source does
not provide (positions, per-event timeline, per-player loadout, ultimate points) are simply
absent — they are NOT imputed. See docs/DATA_SCHEMA.md for the confirmed/future split.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any

from . import provenance as prov


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _split(row: dict, base: str) -> dict:
    """Pack VCT Reference's _all/_atk/_def columns into {all, atk, def}."""
    return {
        "all": row.get(f"{base}_all"),
        "atk": row.get(f"{base}_atk"),
        "def": row.get(f"{base}_def"),
    }


def _rows(con, sql: str, params: list | None = None) -> list[dict]:
    cur = con.execute(sql, params or [])
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]


def normalize_match(duckdb_path: str, match_id: str) -> dict[str, Any]:
    """Return a dict of normalized record lists for one match.

    Keys: match, maps, rounds, teams, players, playerMapStats.
    Raises FileNotFoundError if the db is missing, ValueError if the match is absent.
    """
    import duckdb  # local import so the synthetic path needs no duckdb

    if not os.path.exists(duckdb_path):
        raise FileNotFoundError(duckdb_path)
    sha = _sha256(duckdb_path)
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        m = _rows(con, "SELECT * FROM matches WHERE match_id = ?", [match_id])
        if not m:
            raise ValueError(f"match {match_id!r} not found in {duckdb_path}")
        m = m[0]
        patch = m.get("patch")
        pv = lambda **kw: prov.real(game_patch=patch, source_version=sha[:12], sha256=sha, **kw)  # noqa: E731

        team_ids = [str(m["team0_id"]), str(m["team1_id"])]
        maps_rows = _rows(con, "SELECT * FROM maps WHERE match_id = ? ORDER BY game_id", [match_id])
        game_ids = [str(r["game_id"]) for r in maps_rows]

        match = {
            "matchId": str(m["match_id"]),
            "sourceUrl": m.get("url"),
            "event": m.get("event"),
            "eventId": m.get("event_id"),
            "season": m.get("season"),
            "seriesStage": m.get("series_stage"),
            "seriesRound": m.get("series_round"),
            "utcTimestamp": m["utc_timestamp"].isoformat() if m.get("utc_timestamp") else None,
            "patch": patch,
            "format": m.get("format"),
            "region": m.get("region"),
            "isInternational": m.get("is_international"),
            "teamIds": team_ids,
            "score": [m.get("score0"), m.get("score1")],
            "veto": list(m["veto"]) if m.get("veto") else None,
            "maps": game_ids,
            "coverage": {
                "fetchedOverview": m.get("fetched_overview"),
                "fetchedPerformance": m.get("fetched_performance"),
                "fetchedEconomy": m.get("fetched_economy"),
            },
            "provenance": pv(evidence_type="observed"),
        }

        teams = []
        for t in _rows(con, "SELECT * FROM teams WHERE team_id IN (?, ?)",
                       [m["team0_id"], m["team1_id"]]):
            teams.append({
                "teamId": str(t["team_id"]),
                "name": t.get("team_name"),
                "country": t.get("country"),
                "sourceUrl": t.get("team_url"),
                "provenance": pv(),
            })

        pm_rows = _rows(con, "SELECT * FROM player_map WHERE match_id = ? ORDER BY game_id, team_idx",
                        [match_id])
        player_ids = sorted({r["player_id"] for r in pm_rows})
        players = []
        if player_ids:
            qmarks = ",".join("?" * len(player_ids))
            for p in _rows(con, f"SELECT * FROM players WHERE player_id IN ({qmarks})", list(player_ids)):
                players.append({
                    "playerId": str(p["player_id"]),
                    "handle": p.get("player_name"),
                    "country": p.get("country"),
                    "sourceUrl": p.get("player_url"),
                    "provenance": pv(),
                })

        player_map_stats: dict[str, list] = {g: [] for g in game_ids}
        for r in pm_rows:
            g = str(r["game_id"])
            player_map_stats.setdefault(g, []).append({
                "playerId": str(r["player_id"]),
                "teamIdx": r["team_idx"],
                "agents": list(r["agents"]) if r.get("agents") else [],
                "rating": _split(r, "rating"),
                "acs": _split(r, "acs"),
                "adr": _split(r, "adr"),
                "kills": _split(r, "kills"),
                "deaths": _split(r, "deaths"),
                "assists": _split(r, "assists"),
                "firstKills": _split(r, "fk"),
                "firstDeaths": _split(r, "fd"),
                "kastPct": _split(r, "kast"),
                "headshotPct": _split(r, "hs_pct"),
                "multikills": {"twoK": r.get("two_k"), "threeK": r.get("three_k"),
                               "fourK": r.get("four_k"), "fiveK": r.get("five_k")},
                "clutches": {"v1": r.get("clutch_1v1"), "v2": r.get("clutch_1v2"),
                             "v3": r.get("clutch_1v3"), "v4": r.get("clutch_1v4"),
                             "v5": r.get("clutch_1v5")},
                "econRating": r.get("econ"),
                "plants": r.get("plants"),
                "defuses": r.get("defuses"),
            })

        maps_out, rounds_out = [], []
        for mr in maps_rows:
            g = str(mr["game_id"])
            round_rows = _rows(con, "SELECT * FROM rounds WHERE game_id = ? ORDER BY round_num", [g])
            round_ids = []
            for rr in round_rows:
                rid = f"{g}:{rr['round_num']}"
                round_ids.append(rid)
                has_econ = rr.get("bank_t0") is not None or rr.get("loadout_t0") is not None
                side = rr.get("side")
                rounds_out.append({
                    "roundId": rid,
                    "gameId": g,
                    "matchId": str(mr["match_id"]),
                    "roundNum": rr["round_num"],
                    "winnerTeamIdx": rr.get("winner_team"),
                    "attackingTeamIdx": (0 if side == "attack" else 1) if side else None,
                    "team0Side": side,
                    "outcome": rr.get("outcome"),
                    "startEconomy": {
                        "loadoutValue": [rr.get("loadout_t0"), rr.get("loadout_t1")],
                        "bank": [rr.get("bank_t0"), rr.get("bank_t1")],
                    } if has_econ else None,
                    "plantSite": None,   # FUTURE: from 2D-replay logs
                    "events": [],        # FUTURE: from 2D-replay logs
                    "provenance": pv(evidence_type="observed",
                                     notes=None if has_econ else ["economy not recorded for this round"]),
                })
            maps_out.append({
                "gameId": g,
                "matchId": str(mr["match_id"]),
                "mapName": mr.get("map_name"),
                "pickedByTeamIdx": mr.get("picked_by_team"),
                "durationText": mr.get("duration"),
                "score": [mr.get("score0"), mr.get("score1")],
                "performanceAvailable": mr.get("performance_available"),
                "economyAvailable": mr.get("economy_available"),
                "rounds": round_ids,
                "playerMapStats": player_map_stats.get(g, []),
                "provenance": pv(evidence_type="observed"),
            })

        return {"match": match, "teams": teams, "players": players,
                "maps": maps_out, "rounds": rounds_out}
    finally:
        con.close()


def write_match(duckdb_path: str, match_id: str, out_dir: str) -> dict[str, str]:
    """Normalize one match and write JSON files under out_dir/<match_id>/. Returns paths written."""
    data = normalize_match(duckdb_path, match_id)
    dest = os.path.join(out_dir, str(match_id))
    os.makedirs(dest, exist_ok=True)
    written = {}
    files = {
        "match.json": data["match"],
        "teams.json": data["teams"],
        "players.json": data["players"],
        "maps.json": data["maps"],
        "rounds.json": data["rounds"],
    }
    for name, payload in files.items():
        path = os.path.join(dest, name)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        written[name] = path
    return written
