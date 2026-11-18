#!/usr/bin/env python3
"""Derive real international-Ascent composition stats from the VCT Reference DuckDB.

The DB is NOT committed (daily rebuild + size). Fetch it first with PV-2's script:
    bash <pv-data-checkout>/datasets/raw/vct-reference/download.sh
or directly:
    curl -fSL https://vct-reference.com/dataset/vct.duckdb -o /tmp/vct.duckdb

Then:
    python build_ascent_comps.py --db /tmp/vct.duckdb \
        --out ../../datasets/derived/comps/ascent-comps.json

Output is Layer A stats only (no positions). Rates are map-level, Wilson 95% CI.
Agent roles come from the local catalog (datasets/catalog/release-13.10/agents.json)
or valorant-api as a fallback. Nothing is imputed; missing source values stay absent.
"""
from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(centre - half, 4), round(centre + half, 4)]


def role_lookup() -> dict[str, str]:
    local = REPO / "datasets" / "catalog" / "release-13.10" / "agents.json"
    if local.exists():
        agents = json.loads(local.read_text())
        return {norm(a["name"]): a.get("role") for a in agents}
    import urllib.request
    url = "https://valorant-api.com/v1/agents?isPlayableCharacter=true"
    req = urllib.request.Request(url, headers={"User-Agent": "project-v/1.0"})
    data = json.loads(urllib.request.urlopen(req, timeout=30).read())["data"]
    return {norm(a["displayName"]): (a.get("role") or {}).get("displayName") for a in data}


def _sha256(path: str) -> str:
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build(db_path: str, map_name: str = "Ascent") -> dict:
    import datetime as _dt

    import duckdb  # local import

    db_sha = _sha256(db_path)
    retrieved = _dt.date.today().isoformat()
    con = duckdb.connect(db_path, read_only=True)
    ROLE = role_lookup()
    role = lambda ag: ROLE.get(norm(ag), "Unknown")

    tm = con.execute(
        """
        WITH am AS (
          SELECT m.match_id, m.game_id, m.score0, m.score1
          FROM maps m JOIN matches mt ON m.match_id = mt.match_id
          WHERE m.map_name = ? AND mt.is_international = TRUE
        )
        SELECT pm.match_id, pm.game_id, pm.team_idx,
               list_sort(array_agg(pm.agents[1])) AS comp,
               any_value(am.score0) s0, any_value(am.score1) s1
        FROM player_map pm JOIN am ON pm.match_id = am.match_id AND pm.game_id = am.game_id
        GROUP BY pm.match_id, pm.game_id, pm.team_idx
        HAVING COUNT(*) = 5
        """,
        [map_name],
    ).fetchall()

    rounds = con.execute(
        """
        SELECT r.match_id, r.game_id, r.winner_team, r.side
        FROM rounds r JOIN maps m ON r.match_id = m.match_id AND r.game_id = m.game_id
        JOIN matches mt ON r.match_id = mt.match_id
        WHERE m.map_name = ? AND mt.is_international = TRUE AND r.side IS NOT NULL
        """,
        [map_name],
    ).fetchall()

    rec = defaultdict(lambda: [0, 0, 0, 0])  # atk_w, atk_n, def_w, def_n
    for mid, gid, w, side in rounds:
        for team in (0, 1):
            atk = (team == w and side == "attack") or (team != w and side == "defense")
            won = team == w
            r = rec[(mid, gid, team)]
            if atk:
                r[1] += 1
                r[0] += 1 if won else 0
            else:
                r[3] += 1
                r[2] += 1 if won else 0

    team_maps = len(tm)
    pick = Counter()
    comp_ct = Counter()
    comp_win, comp_atk, comp_def = (defaultdict(lambda: [0, 0]) for _ in range(3))
    tot_atk, tot_def = [0, 0], [0, 0]
    tmpl = Counter()
    for mid, gid, team, comp, s0, s1 in tm:
        comp = tuple(comp)
        for ag in comp:
            pick[ag] += 1
        comp_ct[comp] += 1
        won = (s0 > s1) if team == 0 else (s1 > s0)
        comp_win[comp][0] += 1 if won else 0
        comp_win[comp][1] += 1
        aw, an, dw, dn = rec[(mid, gid, team)]
        comp_atk[comp][0] += aw; comp_atk[comp][1] += an
        comp_def[comp][0] += dw; comp_def[comp][1] += dn
        tot_atk[0] += aw; tot_atk[1] += an
        tot_def[0] += dw; tot_def[1] += dn
        rc = Counter(role(a) for a in comp)
        tmpl[tuple(sorted((r, rc[r]) for r in ["Duelist", "Initiator", "Controller", "Sentinel"] if rc[r]))] += 1

    agents = [
        {"agent": ag, "role": role(ag), "maps": ct, "teamMaps": team_maps,
         "pickRate": round(ct / team_maps, 4), "pickRateCI95": wilson(ct, team_maps)}
        for ag, ct in pick.most_common()
    ]
    comps = []
    for comp, ct in comp_ct.most_common(12):
        w, n = comp_win[comp]; aw, an = comp_atk[comp]; dw, dn = comp_def[comp]
        comps.append({
            "comp": list(comp), "roles": dict(Counter(role(a) for a in comp)),
            "maps": ct, "mapWinRate": round(w / n, 4) if n else None, "mapWinCI95": wilson(w, n),
            "atkRoundWR": round(aw / an, 4) if an else None, "atkRounds": an,
            "defRoundWR": round(dw / dn, 4) if dn else None, "defRounds": dn,
        })
    patches = [r[0] for r in con.execute(
        "SELECT DISTINCT mt.patch FROM maps m JOIN matches mt ON m.match_id=mt.match_id "
        "WHERE m.map_name=? AND mt.is_international=TRUE AND mt.patch IS NOT NULL", [map_name]).fetchall()]
    pk = lambda p: tuple(int(x) for x in (re.search(r"([\d.]+)", p).group(1).split(".") + ["0"])[:2]) if re.search(r"[\d.]+", p) else (0, 0)
    patches_sorted = sorted(patches, key=pk)

    return {
        "schema": "https://project-v/catalog/ascent-comps.schema.json",
        "map": map_name, "filter": "is_international = TRUE",
        "provenance": {
            "source": "VCT Reference DuckDB",
            "sourceUrl": "https://vct-reference.com/dataset/vct.duckdb",
            "landingPage": "https://vct-reference.com/dataset",
            "terms": "https://vct-reference.com/terms",
            "sha256": db_sha,
            "dbBuild": "rebuilt daily", "retrievedAt": retrieved,
            "license": "Free to use incl. commercially; attribution appreciated. Data from public pro match pages; not affiliated with Riot.",
            "evidenceType": "observed", "verified": True,
            "tablesUsed": ["maps", "matches", "player_map", "rounds"],
            "method": "Per team-map (match_id, game_id, team_idx) 5-agent comp from player_map.agents; map win from maps.score0/score1; atk/def round record derived from rounds.winner_team+side. Wilson 95% CI.",
        },
        "sampleCaveats": [
            f"Sample = {team_maps} team-maps ({team_maps // 2} maps) of international Ascent.",
            (f"Patches span {patches_sorted[0]} .. {patches_sorted[-1]} ({len(patches_sorted)} distinct); "
             "aggregates blend multiple metas, NOT stamped to the current build. Ascent rotates in/out of the pool, so recent pick rates may differ."),
            "Agent names are VCT Reference slugs (e.g. 'kayo'); role from the catalog/valorant-api.",
            "Pick/comp rates are map-level. atk/def round WR uses per-round sides derived from rounds.winner_team+side.",
        ],
        "patchesPresent": patches_sorted,
        "patchRangeNumeric": {"min": patches_sorted[0], "max": patches_sorted[-1], "count": len(patches_sorted)},
        "overall": {
            "teamMaps": team_maps,
            "atkRoundWR": round(tot_atk[0] / tot_atk[1], 4) if tot_atk[1] else None, "atkRounds": tot_atk[1],
            "defRoundWR": round(tot_def[0] / tot_def[1], 4) if tot_def[1] else None, "defRounds": tot_def[1],
        },
        "roleTemplates": [{"template": dict(t), "maps": ct, "share": round(ct / team_maps, 4)} for t, ct in tmpl.most_common(8)],
        "pickRate": agents,
        "topComps": comps,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True, help="path to vct.duckdb (not committed)")
    ap.add_argument("--map", default="Ascent")
    ap.add_argument("--out", default=str(REPO / "datasets" / "derived" / "comps" / "ascent-comps.json"))
    args = ap.parse_args()
    out = build(args.db, args.map)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {args.out}: teamMaps={out['overall']['teamMaps']} agents={len(out['pickRate'])} "
          f"atkWR={out['overall']['atkRoundWR']} defWR={out['overall']['defRoundWR']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
