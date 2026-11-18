#!/usr/bin/env python3
"""Assemble the runtime data bundle for packages/game-data.

Single typed data source for the Match Runner (PV-3) and desktop (PV-6). Reads
committed PV-1 data (ability effects, Ascent comps/tactics, patch history) and
PV-2 data (player ratings/names, team names/profiles), extracts recent team
rosters from the VCT Reference DuckDB, and writes JSON into
packages/game-data/data/.

Licence handling:
  - Weapons come from valorant-api (licence unclear) -> written to
    data/weapons.generated.json which is GITIGNORED; the TS loader falls back to
    an embedded manual-approx table when it is absent.
  - Everything else (PV-1 wiki/official-sourced + PV-2 VCT Reference, free incl.
    commercial) is committed with provenance. Real pro names are included by the
    2026-11-18 user decision; name/likeness must be re-reviewed before launch.

PV-2 inputs: when this branch does not yet have PV-2's files merged, pass
--pv2-ref origin/claude/pv-data to read them with `git show`.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PKG = REPO / "packages" / "game-data"
DATA = PKG / "data"

AGENT_ALIASES = {"kayo": "kay-o", "kay/o": "kay-o"}


def norm_agent(slug: str) -> str:
    s = re.sub(r"[^a-z0-9/-]", "", slug.strip().lower())
    return AGENT_ALIASES.get(s, s)


def read_repo_json(rel: str, ref: str | None):
    if ref:
        txt = subprocess.check_output(["git", "show", f"{ref}:{rel}"], cwd=REPO).decode()
        return json.loads(txt)
    return json.loads((REPO / rel).read_text())


def fetch_weapons():
    try:
        req = urllib.request.Request("https://valorant-api.com/v1/weapons",
                                     headers={"User-Agent": "project-v/1.0"})
        data = json.loads(urllib.request.urlopen(req, timeout=30).read())["data"]
    except Exception as e:  # noqa: BLE001
        return None, f"valorant-api unavailable ({e}); TS loader uses manual-approx fallback"
    out = []
    for w in data:
        shop = w.get("shopData") or {}
        ws = w.get("weaponStats") or {}
        out.append({
            "id": w["uuid"], "name": w["displayName"],
            "category": shop.get("category") or (w.get("category") or "").split("::")[-1],
            "cost": shop.get("cost"),
            "fireRate": ws.get("fireRate"), "magazineSize": ws.get("magazineSize"),
            "damageRanges": ws.get("damageRanges") or [],
            "wallPenetration": (ws.get("wallPenetration") or "").split("::")[-1] or None,
        })
    return out, "https://valorant-api.com/v1/weapons"


def extract_rosters(db: str, min_season: int = 2025, keep: int = 7):
    import duckdb
    con = duckdb.connect(db, read_only=True)
    rows = con.execute(
        """
        WITH tm AS (
          SELECT pm.player_id,
            CASE WHEN pm.team_idx=0 THEN mt.team0_id ELSE mt.team1_id END AS team_id,
            mt.utc_timestamp AS ts
          FROM player_map pm JOIN matches mt ON pm.match_id=mt.match_id
          WHERE mt.season >= ? AND (CASE WHEN pm.team_idx=0 THEN mt.team0_id ELSE mt.team1_id END) IS NOT NULL
        )
        SELECT team_id, player_id, COUNT(*) maps, MAX(ts) last_ts
        FROM tm GROUP BY team_id, player_id
        """, [min_season]).fetchall()
    from collections import defaultdict
    teams = defaultdict(list)
    for team_id, pid, maps, last in rows:
        teams[str(team_id)].append({"playerId": str(pid), "maps": maps, "lastSeen": str(last)})
    out = {}
    for tid, plist in teams.items():
        plist.sort(key=lambda x: (-x["maps"], x["lastSeen"]))
        out[tid] = [{"playerId": p["playerId"], "maps": p["maps"]} for p in plist[:keep]]
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", help="VCT Reference DuckDB (for rosters)")
    ap.add_argument("--pv2-ref", default=None, help="git ref holding PV-2 files, e.g. origin/claude/pv-data")
    args = ap.parse_args()
    DATA.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # --- PV-1 committed data (this repo) ---
    effects = read_repo_json("tools/catalog-builder/data/ability_effects.json", None)
    agents_raw = sorted({(e["agentName"],) for e in effects})
    # agent role from catalog if present, else null
    role_map = {}
    cat = REPO / "datasets" / "catalog" / "release-13.10" / "agents.json"
    if cat.exists():
        for a in json.loads(cat.read_text()):
            role_map[norm_agent(a["name"])] = a.get("role")
    agents = []
    by_agent = {}
    for e in effects:
        slug = norm_agent(e["agentName"])
        by_agent.setdefault(slug, {"slug": slug, "name": e["agentName"], "role": role_map.get(slug), "abilities": []})
        by_agent[slug]["abilities"].append({"slot": e["slot"], "name": e["name"], "effectTypes": e["effectTypes"]})
    agents = list(by_agent.values())

    comps = read_repo_json("datasets/derived/comps/ascent-comps.json", None)
    tactics = read_repo_json("datasets/derived/tactics/ascent-tactics.json", None)
    patch = read_repo_json("datasets/derived/meta/patch-history.json", None)
    patch_meta = {
        "currentBuild": patch.get("currentBuild"),
        "dataWindowRecommendation": patch.get("dataWindowRecommendation"),
        "mapStructuralStability": {"Ascent": patch.get("mapStructuralStability")},
    }

    # --- PV-2 data (ratings/names/teams); read from ref if not merged locally ---
    ref = args.pv2_ref
    ratings = read_repo_json("datasets/derived/ratings/player_ratings.json", ref)
    pnames = read_repo_json("datasets/derived/ratings/player_names.json", ref)
    tnames = read_repo_json("datasets/derived/team-profiles/team_names.json", ref)
    tprofiles = read_repo_json("datasets/derived/team-profiles/team_profiles.json", ref)

    rating_by_id = {str(r["playerId"]): r for r in (ratings if isinstance(ratings, list) else ratings.get("players", []))}
    # Base handle set: the full VCT Reference players table (complete, so every
    # roster player resolves) when the DB is available; else PV-2's name export.
    name_by_id = {str(p["playerId"]): p for p in pnames["players"]}
    if args.db:
        import duckdb
        con = duckdb.connect(args.db, read_only=True)
        for pid, handle, country in con.execute("SELECT player_id, player_name, country FROM players").fetchall():
            name_by_id.setdefault(str(pid), {"playerId": str(pid), "handle": handle, "country": country})

    rosters = extract_rosters(args.db) if args.db else {}
    roster_ids = {p["playerId"] for r in rosters.values() for p in r}

    players = []
    seen = set()
    for pid in set(name_by_id) | roster_ids:
        nm = name_by_id.get(pid, {})
        r = rating_by_id.get(pid)
        players.append({
            "playerId": pid, "handle": nm.get("handle"), "country": nm.get("country"),
            "role": (r or {}).get("role"), "attributes": (r or {}).get("attributes"),
            "hasRatings": r is not None,
        })
        seen.add(pid)
    prof_by_id = {str(t["teamId"]): t for t in (tprofiles if isinstance(tprofiles, list) else tprofiles.get("teams", []))}
    teams = []
    for t in tnames["teams"]:
        tid = str(t["teamId"])
        teams.append({"teamId": tid, "name": t.get("name"), "country": t.get("country"),
                      "mapPool": (prof_by_id.get(tid) or {}).get("mapPool")})

    weapons, weapons_src = fetch_weapons()

    meta = {
        "generatedAt": now, "generatedBy": "PV-1 build_game_data",
        "currentBuild": patch.get("currentBuild", "release-13.10"),
        "disclaimer": "Pre-launch INTERNAL dev. Real pro player/team names included by user decision 2026-11-18 (PUBLIC VCT only). Name/likeness + trademark MUST be re-reviewed before launch. Ratings are statistical estimates, not real-ability assessments.",
        "sources": {"abilities_tactics_comps_patch": "PV-1 (official wiki/API + VCT Reference)",
                    "players_teams": "PV-2 (VCT Reference, free incl. commercial)",
                    "rosters": "VCT Reference player_map (recent >=2025)",
                    "weapons": weapons_src},
        "counts": {"agents": len(agents), "abilities": len(effects), "players": len(players),
                   "teams": len(teams), "rosters": len(rosters), "weapons": (len(weapons) if weapons else 0)},
        "rosterAsOf": "recent seasons >=2025 (by appearance count)",
    }

    def w(name, obj):
        (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n")

    w("meta.json", meta)
    w("agents.json", agents)
    w("ability-effects.json", effects)
    w("ascent-comps.json", comps)
    w("ascent-tactics.json", tactics)
    w("patch-meta.json", patch_meta)
    w("players.json", players)
    w("teams.json", teams)
    w("rosters.json", rosters)
    if weapons is not None:
        w("weapons.generated.json", weapons)  # gitignored

    teams_with_5 = sum(1 for tid, r in rosters.items() if len(r) >= 5)
    print(f"game-data bundle: agents={len(agents)} abilities={len(effects)} players={len(players)} "
          f"teams={len(teams)} rosters={len(rosters)} (>=5: {teams_with_5}) weapons={'gen' if weapons else 'fallback'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
